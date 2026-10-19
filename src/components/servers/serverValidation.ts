export interface ServerInput {
  name: string;
  host: string;
  username: string;
  port: number | string;
  ssh_key_path: string;
}

export interface ServerValidationResult {
  valid: boolean;
  errors: Partial<Record<keyof ServerInput, string>>;
}

export function validateServerInput(input: ServerInput): ServerValidationResult {
  const errors: Partial<Record<keyof ServerInput, string>> = {};

  if (!input.name || !input.name.trim()) {
    errors.name = "Server name is required";
  }

  if (!input.host || !input.host.trim()) {
    errors.host = "Host/IP is required";
  }

  if (!input.username || !input.username.trim()) {
    errors.username = "Username is required";
  }

  const portNum = typeof input.port === "number" ? input.port : Number(input.port);
  if (isNaN(portNum) || typeof input.port === "string" && input.port.trim() === "") {
    errors.port = "Port must be a valid number";
  } else if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    errors.port = "Port must be between 1 and 65535";
  }

  if (!input.ssh_key_path || !input.ssh_key_path.trim()) {
    errors.ssh_key_path = "SSH key path is required";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function formatServerAddress(username: string, host: string, port: number): string {
  return `${username}@${host}:${port}`;
}
