export type ProfileSettingRow = {
  label: string;
  value?: string;
};

export const settingsRows: ProfileSettingRow[] = [
  { label: "Currency", value: "INR (₹)" },
  { label: "Language", value: "English" },
  { label: "Appearance", value: "System default" },
  { label: "Notifications" },
];

export const supportRows: ProfileSettingRow[] = [
  { label: "Help Center" },
  { label: "Chat with us" },
];

export const feedbackRows: ProfileSettingRow[] = [{ label: "Rate the app" }];

export const legalRows: ProfileSettingRow[] = [
  { label: "Terms and conditions" },
  { label: "Privacy Policy" },
  { label: "Open-source libraries" },
];

export function runProfileDataChecks(): void {
  if (settingsRows.length !== 4) {
    throw new Error("Profile settings section must include 4 rows.");
  }

  if (supportRows.length !== 2) {
    throw new Error("Profile support section must include 2 rows.");
  }

  if (feedbackRows.length !== 1) {
    throw new Error("Profile feedback section must include 1 row.");
  }

  if (legalRows.length !== 3) {
    throw new Error("Profile legal section must include 3 rows.");
  }
}
