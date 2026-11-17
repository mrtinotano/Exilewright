"""The item filter's alert sounds (PlayAlertSound 1..16) straight from the game: the FMOD bank FMOD/Desktop/Four_ItemFilter.bank
holds them as streams named AlertSound_NN. vgmstream-cli (https://github.com/vgmstream/vgmstream) decodes each one and it is
saved as ../available/sounds/alert_NN.wav, mixed down to mono to keep the files small.
Usage: python sounds.py <gameDir> <vgmstream-cli.exe>"""
import array, os, re, subprocess, sys, tempfile, wave

game, cli = sys.argv[1], sys.argv[2]
bank = os.path.join(game, 'FMOD', 'Desktop', 'Four_ItemFilter.bank')
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'available', 'sounds')
os.makedirs(out, exist_ok=True)

def meta(i):
    return subprocess.run([cli, '-m', '-s', str(i), bank], capture_output=True, text=True, check=True).stdout

count = int(re.search(r'stream count: (\d+)', meta(1)).group(1))
done = 0
with tempfile.TemporaryDirectory() as tmp:
    for i in range(1, count + 1):
        m = re.search(r'stream name: AlertSound_(\d+)', meta(i))
        if not m:
            continue
        raw = os.path.join(tmp, 'raw.wav')
        subprocess.run([cli, '-s', str(i), '-l', '1', '-f', '0', '-o', raw, bank], capture_output=True, check=True)
        with wave.open(raw) as w:
            ch, rate, width = w.getnchannels(), w.getframerate(), w.getsampwidth()
            assert width == 2, 'vgmstream wrote 16-bit samples'
            s = array.array('h', w.readframes(w.getnframes()))
        mono = array.array('h', (sum(s[j:j + ch]) // ch for j in range(0, len(s), ch)))
        with wave.open(os.path.join(out, f'alert_{int(m.group(1)):02}.wav'), 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(mono.tobytes())
        done += 1
assert done == 16, f'{done} alert sounds found, the filter has 16'
print(done, 'alert sounds in', os.path.normpath(out))
