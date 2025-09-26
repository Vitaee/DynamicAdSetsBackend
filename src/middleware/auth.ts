import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/AuthService';
import { UserModel } from '../models/User';
import { AppError } from './errorHandler';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
      };
    }
  }
}

export async function authenticateToken(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      throw new AppError(401, 'Access token is required');
    }

    // Verify token
    const payload = AuthService.verifyAccessToken(token);

    // Get user details
    const user = await UserModel.findById(payload.userId);
    if (!user) {
      throw new AppError(401, 'User not found');
    }

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return next(); // Continue without authentication
  }

  // Try to authenticate, but don't fail if it doesn't work
  authenticateToken(req, res, (error) => {
    if (error) {
      // Just continue without setting req.user
      return next();
    }
    next();
  });
}