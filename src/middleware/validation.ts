import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'

export const validateBody = (schema: z.ZodSchema<any>) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body)
      next()
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: {
            message: 'Validation failed',
            details: error.errors
          }
        })
        return
      }
      next(error)
    }
  }
}

export const validateQuery = (schema: z.ZodSchema<any>) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.query = schema.parse(req.query)
      next()
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: {
            message: 'Query validation failed',
            details: error.errors
          }
        })
        return
      }
      next(error)
    }
  }
}

export const validateParams = (schema: z.ZodSchema<any>) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.params = schema.parse(req.params)
      next()
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: {
            message: 'Params validation failed',
            details: error.errors
          }
        })
        return
      }
      next(error)
    }
  }
}