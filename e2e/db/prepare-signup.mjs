import { readFileSync, writeFileSync } from "node:fs";

// Applied only to the generated CI checkout. Never a hosted Auth setting.
const path = new URL("../supabase/config.toml", import.meta.url);
const source = readFileSync(path, "utf8");
if (!source.includes('project_id = "morada-gestion-e2e"')) throw new Error("Not the throwaway test project");
const config = source
  .replace('[auth.sms]\nenable_signup = false\nenable_confirmations = false', '[auth.sms]\nenable_signup = true\nenable_confirmations = true\n\n[auth.sms.test_otp]\n12025550101 = "123456"\n12025550102 = "123456"')
  .replace('double_confirm_changes = false\nenable_confirmations = false', 'double_confirm_changes = true\nenable_confirmations = true')
  .replace('"http://localhost:4321/**"]', '"http://localhost:4321/**", "https://app.morada.lu/inscription"]');
if (config === source || !config.includes('[auth.sms.test_otp]')) throw new Error("Signup fixture was not applied");
writeFileSync(path, config);
