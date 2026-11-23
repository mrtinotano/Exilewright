# moves.json, the moves the simulator's figure plays (humanoid.js MOVES): clips of a KayKit character or animation file
# (GLB; CC0, see LICENSE), each turned into turns of the figure's own joints, 30 a second.
#   python moves.py Knight.glb moves.json Clip...   adds the clips to those moves.json has
#   python moves.py Knight.glb moves.json           lists the file's clips: when each hand is fastest and furthest forward
#   python moves.py Knight.glb ? Clip...            the hands through those clips, every other frame
# A clip may be 'A@first-last+B@first-last': A to its last frame, then B from its first, one fading into the other.
# What moves.json holds:
#   Knight.glb (KayKit Adventurers 1.0): 1H_Melee_Attack_Slice_Diagonal 1H_Melee_Attack_Slice_Horizontal
#     1H_Melee_Attack_Chop 1H_Melee_Attack_Stab 2H_Melee_Attack_Slice 2H_Melee_Attack_Chop 2H_Ranged_Shooting Throw
#     Unarmed_Melee_Attack_Punch_A Unarmed_Melee_Attack_Punch_B Spellcast_Shoot Spellcast_Raise Spellcast_Long Cheer
#   Rig_Medium_CombatRanged.glb (KayKit Character Animations 1.1): Ranged_Bow_Release@0-20+Ranged_Bow_Draw@9-30
#     Ranged_Bow_Release_Up@0-29+Ranged_Bow_Draw_Up@8-30
import sys, os, json, struct, math
src, dst, want = sys.argv[1], sys.argv[2], sys.argv[3:]
d = open(src, 'rb').read()
n, = struct.unpack('<I', d[12:16]); G = json.loads(d[20:20 + n]); bin0 = 20 + n + 8
acc, bv, nodes = G['accessors'], G['bufferViews'], G['nodes']
def read(i):
    a = acc[i]; v = bv[a['bufferView']]; k = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[a['type']]
    o = bin0 + v.get('byteOffset', 0) + a.get('byteOffset', 0); st = v.get('byteStride', 4 * k)
    return [struct.unpack_from('<%df' % k, d, o + i * st) for i in range(a['count'])]
def mul(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz)
inv = lambda q: (-q[0], -q[1], -q[2], q[3])
def rot(q, v): x, y, z, _ = mul(mul(q, (*v, 0)), inv(q)); return (x, y, z)
def norm(q): L = math.sqrt(sum(x * x for x in q)); return tuple(x / L for x in q)
def arc(a, b):   # the shortest turn that takes the unit vector a to b
    c = (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]); w = 1 + sum(x * y for x, y in zip(a, b))
    return norm((*c, w)) if w > 1e-6 else (1, 0, 0, 0)
sub = lambda a, b: tuple(x - y for x, y in zip(a, b)); add = lambda a, b: tuple(x + y for x, y in zip(a, b))
unit = lambda v: tuple(x / math.sqrt(sum(y * y for y in v)) for x in v)
def lerp(a, b, k, q=False):
    if q and sum(x * y for x, y in zip(a, b)) < 0: b = tuple(-x for x in b)
    r = tuple(x + (y - x) * k for x, y in zip(a, b)); return norm(r) if q else r

par = {c: i for i, nd in enumerate(nodes) for c in nd.get('children', [])}
idx = {nd['name']: i for i, nd in enumerate(nodes)}
order = []   # parents first
def walk(i): order.append(i); [walk(c) for c in nodes[i].get('children', [])]
for r in G['scenes'][0]['nodes']: walk(r)
def pose(clip, t):   # every node's place and turn in the world: at rest, or `t` seconds into a clip
    Q, P = {}, {}
    for i in order:
        nd = nodes[i]; q = tuple(nd.get('rotation', (0, 0, 0, 1))); p = tuple(nd.get('translation', (0, 0, 0)))
        for path, (T, V) in (clip or {}).get(i, {}).items():
            k = 0
            while k < len(T) - 2 and T[k + 1][0] <= t: k += 1
            f = 0 if len(T) < 2 else max(0, min(1, (t - T[k][0]) / ((T[k + 1][0] - T[k][0]) or 1)))
            v = V[k] if len(T) < 2 else lerp(V[k], V[k + 1], f, path == 'rotation')
            if path == 'rotation': q = v
            elif path == 'translation': p = v
        if i in par: Q[i] = mul(Q[par[i]], q); P[i] = add(P[par[i]], rot(Q[par[i]], p))
        else: Q[i], P[i] = q, p
    return Q, P
def clip(name):
    a = next(x for x in G['animations'] if x['name'] == name); out = {}
    for c in a['channels']:
        s = a['samplers'][c['sampler']]; out.setdefault(c['target']['node'], {})[c['target']['path']] = (read(s['input']), read(s['output']))
    return out, max(acc[s['input']]['max'][0] for s in a['samplers'])

# the figure's joints (humanoid.js ORDER), the bone each follows, the bone its own points at (None: the trunk and the feet, upright as they stand) and its parent
SIDES = [('L', '.l'), ('R', '.r')]
JOINTS = [('hips', 'hips', None, None), ('spine', 'spine', None, 'hips'), ('chest', 'chest', None, 'spine'), ('head', 'head', None, 'chest')]
for S, s in SIDES: JOINTS += [('sh' + S, 'upperarm' + s, ('upperarm' + s, 'lowerarm' + s), 'chest'), ('el' + S, 'lowerarm' + s, ('lowerarm' + s, 'wrist' + s), 'sh' + S), ('ha' + S, 'hand' + s, ('wrist' + s, 'hand' + s), 'el' + S)]
for S, s in SIDES: JOINTS += [('hip' + S, 'upperleg' + s, ('upperleg' + s, 'lowerleg' + s), 'hips'), ('kn' + S, 'lowerleg' + s, ('lowerleg' + s, 'foot' + s), 'hip' + S), ('ft' + S, 'foot' + s, None, 'kn' + S)]
Q0, P0 = pose(None, 0)
DOWN = (0, -1, 0)
Ci = {}   # a bone's turn in the world times this is its joint's: both stand alike with the limbs straight down
for j, b, along, _ in JOINTS:
    al = arc(DOWN, unit(sub(P0[idx[along[1]]], P0[idx[along[0]]]))) if along else (0, 0, 0, 1)
    Ci[j] = mul(inv(Q0[idx[b]]), al)
LEG = math.dist(P0[idx['upperleg.l']], P0[idx['lowerleg.l']]) + math.dist(P0[idx['lowerleg.l']], P0[idx['foot.l']])
def frame(c, t):
    Q, P = pose(c, t); W = {j: mul(Q[idx[b]], Ci[j]) for j, b, _, _ in JOINTS}
    q = [W[j] if not up else mul(inv(W[up]), W[j]) for j, _, _, up in JOINTS]
    return q, tuple(x / LEG for x in sub(P[idx['hips']], P0[idx['hips']])), P
if not want:
    print('rest: palm side of the left hand', [round(x, 2) for x in rot(Q0[idx['hand.l']], (0, 0, -1))], 'slot up', [round(x, 2) for x in rot(Q0[idx['handslot.l']], (0, 1, 0))],
          'arm', [round(x, 2) for x in unit(sub(P0[idx['lowerarm.l']], P0[idx['upperarm.l']]))], 'toes', [round(x, 2) for x in P0[idx['toes.l']]], 'leg', round(LEG, 3), 'hips', [round(x, 3) for x in P0[idx['hips']]])
    for a in G['animations']:
        c, dur = clip(a['name'])
        if dur < .2: continue
        N = max(2, round(dur * 30)); pts = [frame(c, dur * i / N)[2] for i in range(N + 1)]; best = {}
        for h in ('hand.r', 'hand.l'):
            sp = [math.dist(pts[i][idx[h]], pts[i - 1][idx[h]]) * 30 for i in range(1, N + 1)]; i = max(range(N), key=lambda i: sp[i])
            fw = max(range(N + 1), key=lambda i: pts[i][idx[h]][2])
            best[h] = 'fastest %.2f s (%.1f m/s), furthest forward %.2f s (z %.2f, y %.2f)' % (dur * (i + .5) / N, sp[i], dur * fw / N, pts[fw][idx[h]][2], pts[fw][idx[h]][1])
        hz = [p[idx['hips']] for p in pts]
        print('%-34s %.2f s | R %s | L %s | hips y %.2f..%.2f z %.2f..%.2f' % (a['name'], dur, best['hand.r'], best['hand.l'], min(p[1] for p in hz), max(p[1] for p in hz), min(p[2] for p in hz), max(p[2] for p in hz)))
    sys.exit()
if dst == '?':   # the named clips, every other frame: the hands from the chest, how far apart, where the chest and the left hand's slot face
    f2 = lambda v: ' '.join('%5.2f' % x for x in v)
    for name in want:
        c, dur = clip(name); N = round(dur * 30); print(name, '%.2f s' % dur)
        for i in range(0, N + 1, 2):
            Q, P = pose(c, dur * i / N); ch = P[idx['chest']]
            print('%.2f | R %s | L %s | apart %.2f | chest faces %s | L arm %s | slot.l up %s | hips %s' % (dur * i / N, f2(sub(P[idx['hand.r']], ch)), f2(sub(P[idx['hand.l']], ch)),
                math.dist(P[idx['hand.r']], P[idx['hand.l']]), f2(rot(Q[idx['chest']], (0, 0, 1))), f2(unit(sub(P[idx['hand.l']], P[idx['upperarm.l']]))), f2(rot(Q[idx['handslot.l']], (0, 1, 0))), f2(sub(P[idx['hips']], P0[idx['hips']]))))
    sys.exit()
r3 = lambda v: [round(x, 3) + 0 for x in v]
names = [j for j, *_ in JOINTS]
out = json.load(open(dst)) if os.path.exists(dst) else {'fps': 30, 'joints': names, 'clips': {}}   # added to the clips the file has (another pack's)
assert out['fps'] == 30 and out['joints'] == names
FADE = 5   # the frames a clip takes to become the one joined to it
sm = lambda k: k * k * (3 - 2 * k)
HALF = math.sqrt(.5)
def world(q, j):   # a joint's turn in the world, from the turns the file keeps
    k = names.index(j); up = JOINTS[k][3]; return mul(world(q, up), q[k]) if up else q[k]
def frames(spec):   # 'Clip' or 'Clip@first-last': every frame of it (each joint's turn, where the hips are) and the two it is cut at
    name, _, cut = spec.partition('@'); c, dur = clip(name); N = max(1, round(dur * 30))
    F = [frame(c, dur * i / N)[:2] for i in range(N + 1)]
    if 'Bow' in name:   # the pack's bow lies across the palm, the figure's along the fist: the bow hand a quarter turn about its own length
        k = names.index('haL'); F = [(q[:k] + [mul(q[k], (0, HALF, 0, HALF))] + q[k + 1:], p) for q, p in F]
    a, b = map(int, cut.split('-')) if cut else (0, N)
    return name, F, a, b
for spec in want:   # A+B: A to its cut, then B from its own, where it stands as A does there
    parts = [frames(x) for x in spec.split('+')]; F = parts[0][1][parts[0][2]:parts[0][3] + 1]; name = '+'.join(x[0] for x in parts)
    for (_, A, _, a1), (_, B, b0, b1) in zip(parts, parts[1:]):
        print('  seam: the joints differ by up to %.0f degrees' % max(2 * math.degrees(math.acos(min(1, abs(sum(x * y for x, y in zip(u, v)))))) for u, v in zip(A[a1][0], B[b0][0])))
        F += [([lerp(x, y, sm(i / (FADE + 1)), True) for x, y in zip(A[a1 + i][0], B[b0 + i][0])], lerp(A[a1 + i][1], B[b0 + i][1], sm(i / (FADE + 1)))) for i in range(1, FADE + 1)] + B[b0 + FADE + 1:b1 + 1]
    if 'Bow' in name:
        h = world(F[0][0], 'haL'); assert abs(rot(h, (0, -1, 0))[0]) < .05 and abs(rot(h, (0, 0, 1))[0]) < .05, 'the bow is not in the plane of the shot'
        print('  ends as it starts within %.0f degrees' % max(2 * math.degrees(math.acos(min(1, abs(sum(x * y for x, y in zip(u, v)))))) for u, v in zip(F[0][0], F[-1][0])))
    out['clips'][name] = {'q': [x for q, _ in F for j in q for x in r3(j)], 'p': [x for _, p in F for x in r3(p)]}
open(dst, 'w', newline='\n').write(json.dumps(out, separators=(',', ':')) + '\n')
print(dst, {k: len(v['p']) // 3 for k, v in out['clips'].items()})
