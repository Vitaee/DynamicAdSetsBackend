import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { UserModel, CreateUserData } from '../models/User';
import { validateEnv } from '../config/env';
import { User } from '@weathertrigger/shared';
import { AppError } from '../middleware/errorHandler';

const env = validateEnv();

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  password: string;
  name: string;
}

export interface AuthResponse {
  user: User;
  token: string;
  refreshToken: string;
}

export interface TokenPayload {
  userId: string;
  email: string;
  type: 'access' | 'refresh';
}

export class AuthService {
  static async register(data: RegisterData): Promise<AuthResponse> {
    const { email, password, name } = data;

    // Check if user already exists
    const existingUser = await UserModel.emailExists(email);
    if (existingUser) {
      throw new AppError(400, 'User with this email already exists');
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create user
    const userData: CreateUserData = {
      email,
      passwordHash,
      name,
    };

    const user = await UserModel.create(userData);

    // Generate tokens
    const token = this.generateAccessToken(user);
    const refreshToken = this.generateRefreshToken(user);

    return {
      user,
      token,
      refreshToken,
    };
  }

  static async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const { email, password } = credentials;

    // Find user by email
    const user = await UserModel.findByEmail(email);
    if (!user) {
      throw new AppError(401, 'Invalid email or password');
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      throw new AppError(401, 'Invalid email or password');
    }

    // Update last login
    await UserModel.updateLastLogin(user.id);

    // Generate tokens
    const token = this.generateAccessToken(user);
    const refreshToken = this.generateRefreshToken(user);

    // Remove password hash from response
    const { password_hash, ...userResponse } = user;

    return {
      user: userResponse,
      token,
      refreshToken,
    };
  }

  static async refreshToken(token: string): Promise<AuthResponse> {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
      
      if (payload.type !== 'refresh') {
        throw new AppError(401, 'Invalid refresh token');
      }

      // Find user
      const user = await UserModel.findById(payload.userId);
      if (!user) {
        throw new AppError(401, 'User not found');
      }

      // Generate new tokens
      const newToken = this.generateAccessToken(user);
      const newRefreshToken = this.generateRefreshToken(user);

      return {
        user,
        token: newToken,
        refreshToken: newRefreshToken,
      };
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new AppError(401, 'Invalid refresh token');
      }
      throw error;
    }
  }

  static verifyAccessToken(token: string): TokenPayload {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
      
      if (payload.type !== 'access') {
        throw new AppError(401, 'Invalid access token');
      }

      return payload;
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new AppError(401, 'Invalid or expired token');
      }
      throw error;
    }
  }

  private static generateAccessToken(user: User): string {
    const payload: TokenPayload = {
      userId: user.id,
      email: user.email,
      type: 'access',
    };

    const options: any = {
      expiresIn: '15m', // Short-lived access token
    };
    
    return jwt.sign(payload, env.JWT_SECRET, options);
  }

  private static generateRefreshToken(user: User): string {
    const payload: TokenPayload = {
      userId: user.id,
      email: user.email,
      type: 'refresh',
    };

    const options: any = {
      expiresIn: env.JWT_EXPIRES_IN, // Long-lived refresh token (7 days)
    };
    
    return jwt.sign(payload, env.JWT_SECRET, options);
  }
}