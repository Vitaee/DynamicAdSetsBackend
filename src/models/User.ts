import { query } from '../config/database';
import { User } from '@weathertrigger/shared';

export interface CreateUserData {
  email: string;
  passwordHash: string;
  name: string;
}

export class UserModel {
  static async create(userData: CreateUserData): Promise<User> {
    const { email, passwordHash, name } = userData;
    
    const result = await query(
      `INSERT INTO users (email, password_hash, name) 
       VALUES ($1, $2, $3) 
       RETURNING id, email, name, created_at, updated_at`,
      [email, passwordHash, name]
    );

    return result.rows[0];
  }

  static async findByEmail(email: string): Promise<(User & { password_hash: string }) | null> {
    const result = await query(
      `SELECT id, email, password_hash, name, created_at, updated_at 
       FROM users 
       WHERE email = $1`,
      [email]
    );

    return result.rows[0] || null;
  }

  static async findById(id: string): Promise<User | null> {
    const result = await query(
      `SELECT id, email, name, created_at, updated_at 
       FROM users 
       WHERE id = $1`,
      [id]
    );

    return result.rows[0] || null;
  }

  static async updateLastLogin(id: string): Promise<void> {
    await query(
      `UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id]
    );
  }

  static async emailExists(email: string): Promise<boolean> {
    const result = await query(
      `SELECT 1 FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );

    return result.rows.length > 0;
  }
}