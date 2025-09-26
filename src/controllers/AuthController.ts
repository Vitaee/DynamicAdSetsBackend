import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/AuthService';
import { createUserSchema, loginSchema } from '@weathertrigger/shared';
import { AppError } from '../middleware/errorHandler';

export class AuthController {
  static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Validate request body
      const validatedData = createUserSchema.parse(req.body);

      // Register user
      const result = await AuthService.register(validatedData);

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Validate request body
      const validatedCredentials = loginSchema.parse(req.body);

      // Login user
      const result = await AuthService.login(validatedCredentials);

      res.json({
        success: true,
        message: 'Login successful',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async refreshToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        throw new AppError(400, 'Refresh token is required');
      }

      // Refresh tokens
      const result = await AuthService.refreshToken(refreshToken);

      res.json({
        success: true,
        message: 'Tokens refreshed successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async logout(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // In a more complex system, you'd invalidate the tokens here
      // For now, we'll just return success as the client should remove the tokens
      
      res.json({
        success: true,
        message: 'Logout successful',
      });
    } catch (error) {
      next(error);
    }
  }

  static async getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // User is attached to request by auth middleware
      if (!req.user) {
        throw new AppError(401, 'User not authenticated');
      }

      res.json({
        success: true,
        data: {
          user: req.user,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}