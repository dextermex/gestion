import { readFileSync, writeFileSync } from "node:fs";

// Applied only to the generated CI checkout. Never a hosted Auth setting.
const path = new URL("../supabase/config.toml", import.meta.url);
const source = readFileSync(path, "utf8");
if (!source.includes('project_id = "morada-gestion-e2e"')) throw new Error("Not the throwaway test project");
const config = source
  .replace('[auth.sms]\nenable_signup = false\nenable_confirmations = false', `[auth.sms]
enable_signup = true
enable_confirmations = true

[auth.sms.test_otp]
12025550101 = "123456"
12025550102 = "123456"

# The CLI requires a selected provider even for its local test-OTP map.
# These inert values are not credentials; only the two fixture numbers work.
[auth.sms.twilio]
enabled = true
account_sid = "AC00000000000000000000000000000000"
message_service_sid = "MG00000000000000000000000000000000"
auth_token = "local-only-not-a-secret"`)
  .replace('double_confirm_changes = false\nenable_confirmations = false', 'double_confirm_changes = true\nenable_confirmations = true')
  .replace('"http://localhost:4321/**"]', '"http://localhost:4321/**", "https://app.morada.lu/inscription"]');
if (config === source || !config.includes('[auth.sms.test_otp]')) throw new Error("Signup fixture was not applied");
// The hosted email-change template (link and six-digit code), so the suite
// reads the same code a person does. Paths resolve from the e2e workdir.
const templated = config + `
[auth.email.template.email_change]
subject = "Confirm your Morada email address"
content_path = "../supabase/templates/email_change.html"
`;
writeFileSync(path, templated);
