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
        --enterprise) SCOPE_KIND=enterprises; SCOPE="$2" ;;
        --org) SCOPE_KIND=organizations; SCOPE="$2" ;;
        --month) MONTH="$2" ;;
      esac
      shift 2 ;;
    *) echo "$USAGE" >&2; exit 2 ;;
  esac
done
[ -n "$SCOPE" ] || { echo "$USAGE" >&2; exit 2; }
if [ -n "$MONTH" ] && ! [[ "$MONTH" =~ ^[0-9]{4}-(0[1-9]|1[0-2])$ ]]; then
  echo "--month expects YYYY-MM, got: $MONTH" >&2; exit 2
fi
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
gh api "$SCOPE_KIND/$SCOPE/settings/billing/usage?year=$YEAR&month=$MON" 2>/dev/null | python3 -c "
import json,sys
from collections import defaultdict
kind,scope=sys.argv[1],sys.argv[2]
d=json.load(sys.stdin); items=d.get('usageItems',[])
if not items: print('  no usageItems (wrong scope/period, or nothing billed)'); sys.exit()
gross=lambda i: i.get('grossAmount',0) or 0
net=lambda i: i.get('netAmount',0) or 0
pair=lambda: [0.0,0.0]
byprod=defaultdict(pair); bysku=defaultdict(pair); byrepo=defaultdict(lambda: [0.0,0.0,0.0])
foreign=0
for i in items:
    g,n=gross(i),net(i); prod=i.get('product','?')
    for acc in (byprod[prod], bysku[(prod,i.get('sku','?'))]): acc[0]+=g; acc[1]+=n
    org=i.get('organizationName') or ''
    if kind=='organizations' and org and org.lower()!=scope.lower(): foreign+=1
    if prod=='actions':
        repo=i.get('repositoryName') or '(none)'
        if kind=='enterprises' and org: repo=org+'/'+repo
        r=byrepo[repo]; r[0]+=g; r[1]+=n
        if i.get('unitType')=='Minutes': r[2]+=i.get('quantity',0) or 0
tg=sum(gross(i) for i in items); tn=sum(net(i) for i in items)
print(f'  TOTAL gross \${tg:.2f}  net \${tn:.2f}  ({len(items)} line items)')
if foreign: print(f'  WARNING: {foreign} line items name another org; their repo labels are not this org\'s')
print('  -- by product (gross / net) --')
for p,(g,n) in sorted(byprod.items(),key=lambda x:-x[1][0]):
    if abs(g)>0.005: print(f'    {g:9.2f} {n:9.2f}  {p}')
print('  -- top SKUs (gross / net) --')
for (p,s),(g,n) in sorted(bysku.items(),key=lambda x:-x[1][0])[:12]:
    if abs(g)>0.005: print(f'    {g:9.2f} {n:9.2f}  {p} / {s}')
print('  -- Actions by repo, ranked by gross (the cost driver lives here) --')
print(f'    {\"gross\":>9} {\"net\":>9} {\"minutes\":>9}  repo')
for r,(g,n,m) in sorted(byrepo.items(),key=lambda x:-x[1][0])[:15]:
    if abs(g)>0.005: print(f'    {g:9.2f} {n:9.2f} {m:9.0f}  {r}')
print('  (net = gross minus included minutes, a pool the enterprise draws down through')
print('   the month: early-month runs net ~\$0, late-month runs net full price, so rank')
print('   by gross. A public repo bills gross and nets \$0: its minutes are free.)')
" "$SCOPE_KIND" "$SCOPE"

# GHAS seats only make sense at enterprise scope.
if [ "$SCOPE_KIND" = enterprises ]; then
  echo "### GHAS committer seats (per-committer billing)"
  for prod in secret_protection code_security; do
    line=$(gh api "enterprises/$SCOPE/settings/billing/advanced-security?advanced_security_product=$prod" \
             --jq '"used=\(.total_advanced_security_committers) max=\(.maximum_advanced_security_committers)"' 2>/dev/null || echo "n/a")
    printf '  %-18s %s\n' "$prod" "$line"
  done
  echo "  (Secret Protection ~\$19/committer/mo · Code Security ~\$30/committer/mo · Dependabot+dep-graph are FREE)"
fi
