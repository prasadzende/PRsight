# Generates invented golden-test fixtures: four PRs for made-up ticket 424242 in a made-up "acme-org".
# Nothing here comes from a real repository.
import json, os, sys

OUT = sys.argv[1]
OWNER = "acme-org"
TICKET = "424242"
os.makedirs(OUT, exist_ok=True)


def pr(repo, number, title, branch, body, files, author="sam-dev", base="main", teams=None):
    return {
        "owner": OWNER, "repo": repo, "number": number, "title": title, "author": author, "draft": False, "state": "open",
        "branch": branch, "base": base, "url": f"https://github.com/{OWNER}/{repo}/pull/{number}", "body": body,
        "additions": sum(f["additions"] for f in files), "deletions": sum(f["deletions"] for f in files), "changedFiles": len(files),
        "updatedAt": "2026-10-20T10:00:00Z", "headSha": (f"{number:02d}" * 20)[:40], "requestedReviewers": [], "requestedTeams": teams or [],
    }


def f(path, status, patch, additions=None, deletions=None):
    lines = patch.split("\n")
    a = sum(1 for l in lines if l.startswith("+")) if additions is None else additions
    d = sum(1 for l in lines if l.startswith("-")) if deletions is None else deletions
    return {"path": path, "status": status, "additions": a, "deletions": d, "patch": patch}


def copilot(cid, path, line, hunk, body):
    return {"id": cid, "inReplyTo": None, "path": path, "line": line, "originalLine": line, "diffHunk": hunk,
            "author": "Copilot", "isBot": True, "body": body, "createdAt": "2026-10-20T11:00:00Z"}


def comment(cid, author, body):
    return {"id": cid, "author": author, "isBot": False, "body": body, "createdAt": "2026-10-20T12:00:00Z"}


def commits(*msgs):
    return [{"sha": f"{i:040x}", "message": m} for i, m in enumerate(msgs, 1)]


def save(name, snap):
    with open(os.path.join(OUT, name), "w") as fh:
        json.dump(snap, fh, indent=2)
        fh.write("\n")


# ---------------------------------------------------------------- 1. config: renames rpm in team config
schema_patch = """@@ -40,7 +40,7 @@
       "properties": {
-        "rpm": { "type": "integer", "minimum": 1 },
+        "requestsPerMinute": { "type": "integer", "minimum": 1 },
         "dailyLimit": { "type": "integer", "minimum": 0 }
       }"""
dev_patch = """@@ -8,6 +8,6 @@ quota:
 quota:
-  rpm: 600
-  dailyLimit: 2000000
+  requestsPerMinute: 600
+  dailyLimit: 100000
   alerts: true"""
prod_patch = """@@ -8,5 +8,5 @@ quota:
 quota:
-  rpm: 1200
+  requestsPerMinute: 1200
   dailyLimit: 5000000"""
cfg_test_patch = """@@ -1,4 +1,4 @@
 quota:
-  rpm: 10
+  requestsPerMinute: 10
   dailyLimit: 1000"""
cfg_files = [
    f("team/team.config.schema.json", "modified", schema_patch),
    f("team/alpha/dev/config.yaml", "modified", dev_patch),
    f("team/alpha/prod/config.yaml", "modified", prod_patch),
    f("tests/fixtures/team/example/config.yaml", "modified", cfg_test_patch),
]
save("acme-platform-config-14.json", {
    "pr": pr("acme-platform-config", 14, f"{TICKET} - Rename rpm to requestsPerMinute in team config", f"feature/{TICKET}-requests-per-minute",
             "This pull request renames the per-team rate limit key from rpm to requestsPerMinute so the name says what it counts.\n\n"
             "It also lowers the alpha dev daily limit while the new quota is tested.\n\n## Testing\n- Schema validation passes for every team file.",
             cfg_files),
    "files": cfg_files,
    "contents": {
        "team/team.config.schema.json": '{\n  "type": "object",\n  "properties": {\n    "quota": {\n      "type": "object",\n      "properties": {\n        "requestsPerMinute": { "type": "integer", "minimum": 1 },\n        "dailyLimit": { "type": "integer", "minimum": 0 }\n      }\n    }\n  }\n}\n',
        "team/alpha/dev/config.yaml": "team: alpha\nquota:\n  requestsPerMinute: 600\n  dailyLimit: 100000\n  alerts: true\n",
        "team/alpha/prod/config.yaml": "team: alpha\nquota:\n  requestsPerMinute: 1200\n  dailyLimit: 5000000\n",
        "tests/fixtures/team/example/config.yaml": "quota:\n  requestsPerMinute: 10\n  dailyLimit: 1000\n",
    },
    "reviewComments": [
        copilot(1401, "team/team.config.schema.json", 43, "@@ -40,7 +40,7 @@\n+        \"requestsPerMinute\": { \"type\": \"integer\", \"minimum\": 1 },",
                "Consider adding a maximum to requestsPerMinute so a typo cannot grant an unbounded rate."),
    ],
    "issueComments": [comment(1451, "lee-reviewer", "Looks good. Let's merge this with the module change.")],
    "commits": commits(f"{TICKET} rename rpm to requestsPerMinute", "Lower alpha dev daily limit"),
    "ruleFiles": {},
})

# ---------------------------------------------------------------- 2. lib: module reads the new name and writes the usage record
lib_main_patch = """@@ -12,10 +12,14 @@ locals {
 locals {
-  rpm = var.team.rpm
+  requestsPerMinute = var.team.requestsPerMinute
 }

 resource "azapi_resource" "usage_record" {
   body = {
+    monthlyBudget = var.team.budget
+    usagePlanTier = var.team.tier
+    requestsPerMinute = local.requestsPerMinute
   }
 }

+resource "azapi_resource_action" "retire_master_key" {
+  type   = "subscriptions/master"
+  method = "DELETE"
+}"""
lib_vars_patch = """@@ -3,7 +3,7 @@ variable "team" {
   type = object({
-    rpm = number
+    requestsPerMinute = number
     budget = number
     tier = string
   })"""
lib_test_patch = """@@ -5,4 +5,4 @@ run "quota" {
   assert {
-    condition = local.rpm == 600
+    condition = local.requestsPerMinute == 600
   }"""
lib_files = [
    f("terraform/modules/usage_quota/main.tf", "modified", lib_main_patch),
    f("terraform/modules/usage_quota/variables.tf", "modified", lib_vars_patch),
    f("terraform/tests/usage_quota.tftest.hcl", "modified", lib_test_patch),
]
save("acme-platform-lib-18.json", {
    "pr": pr("acme-platform-lib", 18, f"{TICKET} - Usage quota module reads requestsPerMinute", f"feature/{TICKET}-usage-record",
             "This pull request updates the usage quota module to read requestsPerMinute and to write monthlyBudget and usagePlanTier into the usage record the gateway reads.\n\n"
             "It also retires the old shared master key.", lib_files, teams=["platform-reviewers"]),
    "files": lib_files,
    "contents": {
        "terraform/modules/usage_quota/main.tf": 'locals {\n  requestsPerMinute = var.team.requestsPerMinute\n}\n\nresource "azapi_resource" "usage_record" {\n  body = {\n    monthlyBudget = var.team.budget\n    usagePlanTier = var.team.tier\n    requestsPerMinute = local.requestsPerMinute\n  }\n}\n\nresource "azapi_resource_action" "retire_master_key" {\n  type   = "subscriptions/master"\n  method = "DELETE"\n}\n',
        "terraform/modules/usage_quota/variables.tf": 'variable "team" {\n  description = "Team quota settings"\n  type = object({\n    requestsPerMinute = number\n    budget = number\n    tier = string\n  })\n}\n',
        "terraform/tests/usage_quota.tftest.hcl": 'run "quota" {\n  assert {\n    condition = local.requestsPerMinute == 600\n  }\n}\n',
    },
    "reviewComments": [
        copilot(1801, "terraform/modules/usage_quota/main.tf", 24, "@@ -12,10 +12,14 @@ locals {\n+  method = \"DELETE\"",
                "The master subscription cannot be deleted while products still reference it, so this apply will fail on first run."),
        copilot(1802, "terraform/modules/usage_quota/variables.tf", 5, "@@ -3,7 +3,7 @@ variable \"team\" {\n+    requestsPerMinute = number",
                "Add a validation block so requestsPerMinute must be a positive whole number."),
    ],
    "issueComments": [comment(1851, "lee-reviewer", "Needs the config PR to go in at the same time.")],
    "commits": commits(f"{TICKET} module reads requestsPerMinute", "Write budget and tier into the usage record", "Retire master key"),
    "ruleFiles": {},
})

# ---------------------------------------------------------------- 3. gateway: policy reads the usage record, still uses rpm
policy_patch = """@@ -1,6 +1,12 @@
 <policies>
   <inbound>
+    <set-variable name="monthlyBudget" value="@(context.Variables.GetValueOrDefault&lt;JObject&gt;(&quot;usage&quot;)[&quot;monthlyBudget&quot;])" />
+    <set-variable name="usagePlanTier" value="@(context.Variables.GetValueOrDefault&lt;JObject&gt;(&quot;usage&quot;)[&quot;usagePlanTier&quot;])" />
+    <rate-limit-by-key calls="@((int)context.Variables[&quot;usage&quot;][&quot;rpm&quot;])" renewal-period="60" counter-key="@(context.Subscription.Id)" />
+    <choose>
+      <when condition="@((string)context.Variables[&quot;usagePlanTier&quot;] == &quot;free&quot;)" />
+    </choose>
   </inbound>
 </policies>"""
policy_content = """<policies>
  <inbound>
    <set-variable name="monthlyBudget" value="@(context.Variables.GetValueOrDefault&lt;JObject&gt;(&quot;usage&quot;)[&quot;monthlyBudget&quot;])" />
    <set-variable name="usagePlanTier" value="@(context.Variables.GetValueOrDefault&lt;JObject&gt;(&quot;usage&quot;)[&quot;usagePlanTier&quot;])" />
    <rate-limit-by-key calls="@((int)context.Variables[&quot;usage&quot;][&quot;rpm&quot;])" renewal-period="60" counter-key="@(context.Subscription.Id)" />
    <choose>
      <when condition="@((string)context.Variables[&quot;usagePlanTier&quot;] == &quot;free&quot;)" />
    </choose>
  </inbound>
</policies>
"""
gw_vars_patch = """@@ -20,3 +20,9 @@ variable "gateway_name" {
 }
+
+variable "quota_alert_percent" {
+  description = "Percentage of the monthly budget at which teams are warned"
+  type        = number
+  default     = 80
+}"""
gw_vars_content = 'variable "gateway_name" {\n  description = "Name of the API gateway"\n  type        = string\n}\n\nvariable "quota_alert_percent" {\n  description = "Percentage of the monthly budget at which teams are warned"\n  type        = number\n  default     = 80\n}\n'
gw_cfg_patch = """@@ -4,3 +4,4 @@ gatewayName: acme-gw-dev
 region: westeurope
+quotaAlertPercent: 80"""
gw_schema_patch = """@@ -10,6 +10,10 @@
     "region": { "type": "string" },
+    "quotaAlertPercent": {
+      "type": "integer",
+      "minimum": 1
+    },
     "gatewayName": { "type": "string" }"""
gw_ci_patch = """@@ -0,0 +1,6 @@
+parameters:
+  - name: workingDir
+    type: string
+steps:
+  - script: terraform plan -input=false
+    workingDirectory: ${{ parameters.workingDir }}"""
gw_test_patch = """@@ -10,3 +10,7 @@ run "policy" {
 }
+
+run "alert_percent" {
+  variables { quota_alert_percent = 80 }
+}"""
gw_files = [
    f("terraform/gateway/modules/apim/policies/usage-quota.xml", "modified", policy_patch, additions=60, deletions=0),
    f("terraform/gateway/modules/apim/variables.tf", "modified", gw_vars_patch),
    f("config/gateway/dev.yaml", "modified", gw_cfg_patch),
    f("config/gateway/config.schema.json", "modified", gw_schema_patch),
    f(".ci/templates/terraform-plan.yaml", "added", gw_ci_patch),
    f("terraform/gateway/tests/apim.tftest.hcl", "modified", gw_test_patch),
]
rules = """# Copilot instructions for acme-platform-gateway

## Pipelines
- Every file in `.ci/templates/` must be prefixed with its tool, `terraform-` or `bicep-`.

## YAML
Always use the `.yaml` extension. Never use `.yml`. Existing `.yml` files under `.github/` keep their names.

## Configuration
Whenever a key is added or removed, you **must** update `config/<deployment>/config.schema.json` in the same pull request.

## Terraform
Always give variables a `description` and `type`.

- **Keep modules focused**: one module, one job.
"""
save("acme-platform-gateway-34.json", {
    "pr": pr("acme-platform-gateway", 34, f"{TICKET} - Gateway enforces usage quotas", f"feature/{TICKET}-gateway-quota",
             "This pull request makes the gateway read monthlyBudget and usagePlanTier from the usage record and apply the per-team rate limit.\n\n"
             "It adds a quota alert setting with its schema entry.", gw_files),
    "files": gw_files,
    "contents": {
        "terraform/gateway/modules/apim/policies/usage-quota.xml": policy_content,
        "terraform/gateway/modules/apim/variables.tf": gw_vars_content,
        "config/gateway/dev.yaml": "gatewayName: acme-gw-dev\nregion: westeurope\nquotaAlertPercent: 80\n",
        "config/gateway/config.schema.json": '{\n  "type": "object",\n  "properties": {\n    "region": { "type": "string" },\n    "quotaAlertPercent": {\n      "type": "integer",\n      "minimum": 1\n    },\n    "gatewayName": { "type": "string" }\n  }\n}\n',
        ".ci/templates/terraform-plan.yaml": "parameters:\n  - name: workingDir\n    type: string\nsteps:\n  - script: terraform plan -input=false\n    workingDirectory: ${{ parameters.workingDir }}\n",
        "terraform/gateway/tests/apim.tftest.hcl": 'run "policy" {\n}\n\nrun "alert_percent" {\n  variables { quota_alert_percent = 80 }\n}\n',
    },
    "reviewComments": [
        copilot(3401, "terraform/gateway/modules/apim/policies/usage-quota.xml", 5, "@@ -1,6 +1,12 @@\n+    <rate-limit-by-key calls=\"...\" />",
                "This policy still reads the old rpm field; consider switching it to requestsPerMinute once the module change is in."),
    ],
    "issueComments": [comment(3451, "lee-reviewer", "Please merge after the module PR.")],
    "commits": commits(f"{TICKET} read budget and tier in the gateway", "Add quota alert setting", "Add plan template"),
    "ruleFiles": {".github/copilot-instructions.md": rules},
})

# ---------------------------------------------------------------- 4. docs: design record for the rename
adr = """# ADR-0007 — Per-team usage quotas

## Status
Accepted

## Decision
Teams set `requestsPerMinute` and a `dailyLimit` in their config. The usage quota module writes `monthlyBudget` and `usagePlanTier` into the usage record, and the gateway reads them on every call.

## Consequences
- The old `rpm` name is retired everywhere.
- Config, module and gateway changes ship together.
"""
adr_patch = "@@ -0,0 +1,13 @@\n" + "\n".join("+" + l for l in adr.rstrip("\n").split("\n"))
doc_files = [f("docs/design/ADR-0007-usage-quotas.md", "added", adr_patch)]
save("acme-platform-50.json", {
    "pr": pr("acme-platform", 50, f"{TICKET} - ADR for per-team usage quotas", f"docs/{TICKET}-usage-quotas-adr",
             "This pull request adds the design record for per-team usage quotas and the requestsPerMinute name.", doc_files, teams=["architecture"]),
    "files": doc_files,
    "contents": {"docs/design/ADR-0007-usage-quotas.md": adr},
    "reviewComments": [],
    "issueComments": [comment(5051, "lee-reviewer", "Thanks, this matches the PRs.")],
    "commits": commits(f"{TICKET} add usage quotas ADR"),
    "ruleFiles": {},
})
print("wrote", sorted(os.listdir(OUT)))
