import { Router } from 'express'
import { z } from 'zod'
import { WeatherService } from '../services/WeatherService'
// import { authenticateToken } from '../middleware/auth' // Temporarily disabled
import { validateBody, validateQuery } from '../middleware/validation'

const router = Router()
const weatherService = new WeatherService()

const getCurrentWeatherSchema = z.object({
  lat: z.string().transform(Number),
  lon: z.string().transform(Number)
})

const getCityWeatherSchema = z.object({
  city: z.string().min(1),
  country: z.string().optional()
})

const checkConditionSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  condition: z.object({
    condition: z.enum(['rain', 'snow', 'storm', 'clear', 'clouds', 'fog', 'extreme']),
    operator: z.enum(['is', 'is_not']),
    temperature: z.object({
      min: z.number().optional(),
      max: z.number().optional(),
      unit: z.enum(['celsius', 'fahrenheit'])
    }).optional(),
    windSpeed: z.object({
      min: z.number().optional(),
      max: z.number().optional(),
      unit: z.enum(['mph', 'kmh'])
    }).optional()
  })
})

router.get('/current', 
  // authenticateToken, // Temporarily disabled for testing
  validateQuery(getCurrentWeatherSchema),
  async (req, res) => {
    try {
      const { lat, lon } = req.query as any
      const weather = await weatherService.getCurrentWeather(lat, lon)
      res.json({ success: true, data: weather })
    } catch (error: any) {
      res.status(500).json({ 
        success: false, 
        error: { message: error.message } 
      })
    }
  }
)

router.get('/city',
  // authenticateToken, // Temporarily disabled for testing
  validateQuery(getCityWeatherSchema),
  async (req, res) => {
    try {
      const { city, country } = req.query as any
      const weather = await weatherService.getCurrentWeatherByCity(city, country)
      res.json({ success: true, data: weather })
    } catch (error: any) {
      res.status(500).json({ 
        success: false, 
        error: { message: error.message } 
      })
    }
  }
)

router.post('/check-condition',
  // authenticateToken, // Temporarily disabled for testing
  validateBody(checkConditionSchema),
  async (req, res) => {
    try {
      const { lat, lon, condition } = req.body
      const weather = await weatherService.getCurrentWeather(lat, lon)
      const conditionMet = weatherService.checkWeatherCondition(weather, condition)
      
      res.json({ 
        success: true, 
        data: { 
          conditionMet,
          weather,
          condition
        } 
      })
    } catch (error: any) {
      res.status(500).json({ 
        success: false, 
        error: { message: error.message } 
      })
    }
  }
)

export default router