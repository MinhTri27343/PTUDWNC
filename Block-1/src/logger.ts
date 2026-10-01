import { pino, type DestinationStream, type Logger } from 'pino';
import { config } from './config';

/** stream chỉ dùng trong test để bắt dòng log. */
export function createLogger(stream?: DestinationStream, level: string = config.logLevel): Logger {
  return pino(
    {
      level,
      // Không bao giờ ghi password, token, Authorization.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          '*.password',
          '*.token',
          '*.access_token',
        ],
        censor: '[REDACTED]',
      },
      ...(process.env.LOG_PRETTY === 'true' ? { transport: { target: 'pino-pretty' } } : {}),
    },
    stream,
  );
}
