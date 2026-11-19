import {
  pino,
  multistream,
  destination,
  type DestinationStream,
  type Logger,
} from "pino";
import { build as pretty } from "pino-pretty";
import { config } from "../config";

/**
 * - Có `stream` (test): chỉ ghi vào stream đó, không đụng file.
 * - Không có `stream` (server): ghi đồng thời ra console và vào file `logs/app.log`
 *   (mỗi dòng là một JSON, tìm theo request_id bằng `npm run logs`).
 */
export function createLogger(
  stream?: DestinationStream,
  level: string = config.logLevel,
): Logger {
  const options = {
    level,
    // Không bao giờ ghi password, token, Authorization.
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.body.password",
        "*.password",
        "*.token",
        "*.access_token",
      ],
      censor: "[REDACTED]",
    },
  };
  if (stream) return pino(options, stream);

  const consoleStream: DestinationStream =
    process.env.LOG_PRETTY === "true"
      ? pretty({ colorize: true, sync: true })
      : process.stdout;
  const fileStream = destination({
    dest: config.logFile,
    mkdir: true,
    sync: true,
  });
  return pino(
    options,
    multistream([{ stream: consoleStream }, { stream: fileStream }]),
  );
}
