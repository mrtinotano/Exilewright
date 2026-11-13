"""Query helper: python -I q.py "Gem Name" [...]  -> constant + level-20 stats of gems, human readable."""
import sys, os
g = {'__file__': os.path.join(os.path.dirname(os.path.abspath(__file__)), 'digest.py')}
exec(open(g['__file__'], encoding='utf8').read().split('os.makedirs(OUT')[0], g)
load, describe = g['load'], g['describe']
sg, ge, gr, b, st = load('SkillGems'), load('GemEffects'), load('GrantedEffects'), load('BaseItemTypes'), load('Stats')
ss, sspl = load('GrantedEffectStatSets'), load('GrantedEffectStatSetsPerLevel')
if __name__ == '__main__' and len(sys.argv) > 1 and sys.argv[1] == '--cols':
    print(list(gr[0]), list(ss[0]), list(sspl[0])); sys.exit()

name_to_gem = {b[x['BaseItemType']]['Name'].lower(): x for x in sg}
by_set = {}
for r in sspl:
    by_set.setdefault(r['StatSet'], []).append(r)


def gem_stats(name):
    g = name_to_gem[name.lower()]
    out = []
    for e in g['GemEffects']:
        eff = gr[ge[e]['GrantedEffect']]
        for sid in [eff['StatSet']] + list(eff['AdditionalStatSets'] or []):
            s = ss[sid]
            stats = {st[k]['Id']: v for k, v in zip(s['ConstantStats'], s['ConstantStatsValues'])}
            stats.update({st[k]['Id']: 1 for k in s['ImplicitStats']})
            lv = sorted(by_set.get(sid, []), key=lambda r: r['GemLevel'])
            if lv:
                top = lv[min(19, len(lv) - 1)]
                stats.update({st[k]['Id']: v for k, v in zip(top['AdditionalStats'], top['AdditionalStatsValues'])})
                stats.update({st[k]['Id']: v for k, v in zip(top['FloatStats'], top['FloatStatsValues'])})
            out += describe(stats)
    return out


if __name__ == '__main__':
    for n in sys.argv[1:]:
        print(f'## {n}')
        for l in gem_stats(n):
            print('  ', l)
