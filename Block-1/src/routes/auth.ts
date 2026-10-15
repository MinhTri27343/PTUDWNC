import { Router } from 'express';
import { signToken, verifyCredentials } from '../auth';
import { errors } from '../errors';

export const authRouter = Router();

// Body đã được validator kiểm tra theo LoginRequest trước khi tới đây.
authRouter.post('/login', (req, res) => {
  const { username, password } = req.body as { username: string; password: string };
  if (!verifyCredentials(username, password)) throw errors.invalidCredentials();
  res.json(signToken(username));
});
