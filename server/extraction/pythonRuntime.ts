export type PythonCommand = {
  cmd: string;
  argsPrefix: string[];
};

export function getPythonCommands(): PythonCommand[] {
  if (process.platform === "win32") {
    return [
      { cmd: "python", argsPrefix: [] },
      { cmd: "py", argsPrefix: ["-3"] },
    ];
  }

  return [
    { cmd: "python3", argsPrefix: [] },
    { cmd: "python", argsPrefix: [] },
  ];
}
