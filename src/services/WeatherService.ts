import axios from 'axios'
import { logger } from '../utils/logger'

export interface WeatherData {
  location: {
    name: string
    country: string
    lat: number
    lon: number
  }
  current: {
    temp: number
    feels_like: number
    humidity: number
    pressure: number
    visibility: number
    wind_speed: number
    wind_deg: number
    weather: {
      id: number
      main: string
      description: string
      icon: string
    }[]
  }
  timestamp: number
}

export interface WeatherCondition {
  condition: 'rain' | 'snow' | 'storm' | 'clear' | 'clouds' | 'fog' | 'extreme'
  operator: 'is' | 'is_not'
  temperature?: {
    min?: number
    max?: number
    unit: 'celsius' | 'fahrenheit'
  }
  windSpeed?: {
    min?: number
    max?: number
    unit: 'mph' | 'kmh'
  }
}

export class WeatherService {
  private apiKey: string
  private baseUrl = 'https://api.openweathermap.org/data/2.5'

  constructor() {
    this.apiKey = process.env.OPENWEATHER_API_KEY!
    if (!this.apiKey) {
      throw new Error('OPENWEATHER_API_KEY environment variable is required')
    }
  }

  async getCurrentWeather(lat: number, lon: number): Promise<WeatherData> {
    try {
      const response = await axios.get(`${this.baseUrl}/weather`, {
        params: {
          lat,
          lon,
          appid: this.apiKey,
          units: 'metric'
        }
      })

      const data = response.data
      
      return {
        location: {
          name: data.name,
          country: data.sys.country,
          lat: data.coord.lat,
          lon: data.coord.lon
        },
        current: {
          temp: data.main.temp,
          feels_like: data.main.feels_like,
          humidity: data.main.humidity,
          pressure: data.main.pressure,
          visibility: data.visibility,
          wind_speed: data.wind.speed,
          wind_deg: data.wind.deg,
          weather: data.weather.map((w: any) => ({
            id: w.id,
            main: w.main,
            description: w.description,
            icon: w.icon
          }))
        },
        timestamp: Date.now()
      }
    } catch (error) {
      logger.error('Failed to fetch weather data:', error)
      throw new Error('Failed to fetch weather data')
    }
  }

  async getCurrentWeatherByCity(city: string, countryCode?: string): Promise<WeatherData> {
    try {
      const query = countryCode ? `${city},${countryCode}` : city
      const response = await axios.get(`${this.baseUrl}/weather`, {
        params: {
          q: query,
          appid: this.apiKey,
          units: 'metric'
        }
      })

      const data = response.data
      
      return {
        location: {
          name: data.name,
          country: data.sys.country,
          lat: data.coord.lat,
          lon: data.coord.lon
        },
        current: {
          temp: data.main.temp,
          feels_like: data.main.feels_like,
          humidity: data.main.humidity,
          pressure: data.main.pressure,
          visibility: data.visibility,
          wind_speed: data.wind.speed,
          wind_deg: data.wind.deg,
          weather: data.weather.map((w: any) => ({
            id: w.id,
            main: w.main,
            description: w.description,
            icon: w.icon
          }))
        },
        timestamp: Date.now()
      }
    } catch (error) {
      logger.error('Failed to fetch weather data by city:', error)
      throw new Error('Failed to fetch weather data')
    }
  }

  checkWeatherCondition(weatherData: WeatherData, condition: WeatherCondition): boolean {
    const { current } = weatherData
    const mainWeather = current.weather[0]?.main?.toLowerCase() || ''

    let conditionMet = false

    switch (condition.condition) {
      case 'rain':
        conditionMet = mainWeather === 'rain' || mainWeather === 'drizzle'
        break
      case 'snow':
        conditionMet = mainWeather === 'snow'
        break
      case 'storm':
        conditionMet = mainWeather === 'thunderstorm'
        break
      case 'clear':
        conditionMet = mainWeather === 'clear'
        break
      case 'clouds':
        conditionMet = mainWeather === 'clouds'
        break
      case 'fog':
        conditionMet = mainWeather === 'mist' || mainWeather === 'fog' || mainWeather === 'haze'
        break
      case 'extreme':
        conditionMet = ['tornado', 'squall', 'ash', 'dust', 'sand'].includes(mainWeather)
        break
    }

    if (condition.operator === 'is_not') {
      conditionMet = !conditionMet
    }

    if (condition.temperature) {
      const temp = condition.temperature.unit === 'fahrenheit' 
        ? (current.temp * 9/5) + 32 
        : current.temp

      if (condition.temperature.min !== undefined && temp < condition.temperature.min) {
        conditionMet = false
      }
      if (condition.temperature.max !== undefined && temp > condition.temperature.max) {
        conditionMet = false
      }
    }

    if (condition.windSpeed) {
      const windSpeed = condition.windSpeed.unit === 'mph'
        ? current.wind_speed * 2.237
        : current.wind_speed * 3.6

      if (condition.windSpeed.min !== undefined && windSpeed < condition.windSpeed.min) {
        conditionMet = false
      }
      if (condition.windSpeed.max !== undefined && windSpeed > condition.windSpeed.max) {
        conditionMet = false
      }
    }

    return conditionMet
  }
}