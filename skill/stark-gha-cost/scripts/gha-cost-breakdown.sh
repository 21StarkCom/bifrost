#!/usr/bin/env bash
# GitHub Actions + GHAS cost breakdown for an enterprise (or single org), one month.
#
# Drills the enhanced-billing usage report from product -> SKU -> repo, and
# reports GHAS (Secret Protection / Code Security) committer-seat consumption.
# This is the "where is the money going" first pass — run it before touching any
# workflow.
#
# Auth: GH_TOKEN must be a PAT with admin:enterprise (for the enterprise usage
# endpoint) or admin:org (for a single org). Read it into the env; never print it.
#
# Usage:
#   GH_TOKEN=<pat> ./gha-cost-breakdown.sh --enterprise <slug> [--month YYYY-MM]
#   GH_TOKEN=<pat> ./gha-cost-breakdown.sh --org <login> [--month YYYY-MM]
# --month defaults to the current UTC month.
set -euo pipefail

USAGE="usage: $0 --enterprise <slug> | --org <login> [--month YYYY-MM]"
SCOPE_KIND="" SCOPE="" MONTH=""
while [ $# -gt 0 ]; do
  case "$1" in
    help|--help|-h) echo "$USAGE"; exit 0 ;;
    --enterprise|--org|--month)
      if [ "$#" -lt 2 ]; then echo "$1 requires a value" >&2; exit 2; fi
      case "$2" in --*|-h) echo "$1 requires a value" >&2; exit 2 ;; esac
      case "$1" in
        --month)
          # Checked here, not after the loop: an empty value must refuse, not
          # fall through to the current-month default.
          if ! [[ "$2" =~ ^[0-9]{4}-(0[1-9]|1[0-2])$ ]]; then
            echo "--month expects YYYY-MM, got: $2" >&2; exit 2
          fi
          MONTH="$2" ;;
        *)
          if [ -n "$SCOPE_KIND" ]; then echo "give one scope: --enterprise or --org, once" >&2; exit 2; fi
          if [ "$1" = --enterprise ]; then SCOPE_KIND=enterprises; else SCOPE_KIND=organizations; fi
          SCOPE="$2" ;;
      esac
      shift 2 ;;
    *) echo "$USAGE" >&2; exit 2 ;;
  esac
done
[ -n "$SCOPE" ] || { echo "$USAGE" >&2; exit 2; }
: "${GH_TOKEN:?set GH_TOKEN to an admin:enterprise / admin:org PAT}"
export GH_TOKEN
[ -n "$MONTH" ] || MONTH=$(date -u +%Y-%m)
YEAR=${MONTH%-*} MON=${MONTH#*-}
MON=${MON#0}

echo "### Billing usage — $SCOPE_KIND/$SCOPE, $MONTH"
# The old orgs/{org}/settings/billing/actions endpoint is GONE (HTTP 410). The
# enhanced-billing usage endpoint returns per-line-item {product,sku,quantity,
# unitType,grossAmount,netAmount,organizationName,repositoryName}. Enterprise
# slug works even though the top-level enterprises/{slug} REST route 404s (it's
# GraphQL-only).
#
# Always pass year+month. Without a period the call returns one row per
# (month, SKU) whose amounts are the scope's totals but whose organizationName
# and repositoryName are some other org's repo in the enterprise, so a by-repo
# list built from it names repos the scope does not own.
#
# gh's stderr stays visible: a refused call (scope, token, period) ends the run
# through pipefail, and its HTTP status is the only reason the operator sees.
gh api "$SCOPE_KIND/$SCOPE/settings/billing/usage?year=$YEAR&month=$MON" | python3 -c "
import json,subprocess,sys
from collections import defaultdict
kind,scope=sys.argv[1],sys.argv[2]
def visibility(owner,repo):
    try: return subprocess.run(['gh','api',f'repos/{owner}/{repo}','--jq','.visibility'],capture_output=True,text=True,timeout=30).stdout.strip() or '?'
    except Exception: return '?'
d=json.load(sys.stdin); items=d.get('usageItems',[])
if not items: print('  no usageItems (wrong scope/period, or nothing billed)'); sys.exit()
gross=lambda i: i.get('grossAmount',0) or 0
net=lambda i: i.get('netAmount',0) or 0
pair=lambda: [0.0,0.0]
byprod=defaultdict(pair); bysku=defaultdict(pair); byrepo=defaultdict(lambda: [0.0,0.0,defaultdict(float)])
foreign=0
for i in items:
    g,n=gross(i),net(i); prod=i.get('product','?')
    for acc in (byprod[prod], bysku[(prod,i.get('sku','?'))]): acc[0]+=g; acc[1]+=n
    org=i.get('organizationName') or ''
    other=kind=='organizations' and org and org.lower()!=scope.lower()
    if other: foreign+=1
    if prod=='actions':
        name=i.get('repositoryName') or '(none)'
        owner=org or scope
        repo=(owner+'/'+name) if org and (kind=='enterprises' or other) else name
        r=byrepo[(repo,owner,name)]; r[0]+=g; r[1]+=n
        # Minutes per runner SKU: Linux, Windows and macOS bill 1x/2x/10x, so one summed column compares nothing.
        if (i.get('unitType') or '').lower()=='minutes': r[2][(i.get('sku') or '?').removeprefix('Actions ')]+=i.get('quantity',0) or 0
tg=sum(v[0] for v in byprod.values()); tn=sum(v[1] for v in byprod.values())
print(f'  TOTAL gross \${tg:.2f}  net \${tn:.2f}  ({len(items)} line items)')
if foreign: print(f'  WARNING: {foreign} line items name another org; their repos are listed below as org/repo and are not this org\'s')
print('  -- by product (gross / net) --')
for p,(g,n) in sorted(byprod.items(),key=lambda x:-x[1][0]):
    if abs(g)>0.005: print(f'    {g:9.2f} {n:9.2f}  {p}')
print('  -- top SKUs (gross / net) --')
for (p,s),(g,n) in sorted(bysku.items(),key=lambda x:-x[1][0])[:12]:
    if abs(g)>0.005: print(f'    {g:9.2f} {n:9.2f}  {p} / {s}')
# Public repos bill gross but their minutes are free: list them apart, so the
# ranking holds only repos that cost money. Visibility is looked up only for the
# rows walked, at most 15 private ones plus the public ones met on the way.
paid=[]; public=[]
for (repo,owner,name),(g,n,m) in sorted(byrepo.items(),key=lambda x:-x[1][0]):
    if len(paid)>=15 or abs(g)<=0.005: break
    vis=visibility(owner,name) if name!='(none)' else '?'
    (public if vis=='public' else paid).append((repo,g,n,m,vis))
mins=lambda m: ' '.join(f'{s}={q:.0f}' for s,q in sorted(m.items(),key=lambda x:-x[1]) if q>=0.5)
print('  -- Actions by repo, ranked by gross (the cost driver lives here) --')
print(f'    {\"gross\":>9} {\"net\":>9}  repo  [minutes by runner]')
for repo,g,n,m,vis in paid:
    note='' if vis in ('private','internal') else f'  (visibility {vis})'
    print(f'    {g:9.2f} {n:9.2f}  {repo}  [{mins(m)}]{note}')
if public:
    print('  -- public repos: gross shown, but their minutes are free (\$0) --')
    for repo,g,n,m,vis in public: print(f'    {g:9.2f} {n:9.2f}  {repo}  [{mins(m)}]')
print('  (net = gross minus included minutes, a pool the enterprise draws down through')
print('   the month: early-month runs net ~\$0, late-month runs net full price, so rank')
print('   by gross.)')
" "$SCOPE_KIND" "$SCOPE"

# GHAS seats only make sense at enterprise scope.
if [ "$SCOPE_KIND" = enterprises ]; then
  echo "### GHAS committer seats (per-committer billing; today's count, not --month's)"
  for prod in secret_protection code_security; do
    line=$(gh api "enterprises/$SCOPE/settings/billing/advanced-security?advanced_security_product=$prod" \
             --jq '"used=\(.total_advanced_security_committers) max=\(.maximum_advanced_security_committers)"' 2>/dev/null || echo "n/a")
    printf '  %-18s %s\n' "$prod" "$line"
  done
  echo "  (Secret Protection ~\$19/committer/mo · Code Security ~\$30/committer/mo · Dependabot+dep-graph are FREE)"
fi
