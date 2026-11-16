"""Approx min passive points to reach target nodes from a class root (greedy Steiner over the real tree).
Usage: python -I tree_path.py ROOT_NAME "Node A" "Node B" ...   (ROOT_NAME: WITCH, RANGER, MARAUDER, DUELIST, TEMPLAR, SIX)"""
import json, os, sys
from collections import deque
T = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'available', 'passive_tree.json'), encoding='utf8'))
N = {int(k): v for k, v in T['nodes'].items()}
root = next(r for r in T['class_roots'] if N.get(r, {}).get('name') == sys.argv[1])
ok = lambda n: n == root or (N[n]['ascendancy'] is None and N[n]['name'] not in ('RANGER', 'MARAUDER', 'DUELIST', 'TEMPLAR', 'WITCH', 'SIX'))
targets = {n for n, v in N.items() if v['name'] in sys.argv[2:] and ok(n)}
missing = set(sys.argv[2:]) - {N[n]['name'] for n in targets}
if missing:
    sys.exit(f'not found: {missing}')
tree = {root}
while targets - tree:
    prev = {n: None for n in tree}
    q = deque(tree)
    while q:
        u = q.popleft()
        if u in targets and u not in tree:
            break
        for w in N[u]['links']:
            if w not in prev and ok(w):
                prev[w] = u
                q.append(w)
    while u not in tree:
        tree.add(u)
        u = prev[u]
print(f'{len(tree) - 1} points')
print(', '.join(N[n]['name'] for n in tree if N[n]['type'] in ('notable', 'keystone')))
