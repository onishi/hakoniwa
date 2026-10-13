// One published day has a repeatable forecast. The clock comes from the server.
export const worldClimate = (worldDay: number, now = new Date()) => {
  const hour = (now.getUTCHours() + 9) % 24
  const phase = hour >= 6 && hour < 17 ? 'morning' : hour >= 17 && hour < 21 ? 'evening' : 'night'
  const weather = worldDay < 83 ? 'clear' : (['rain', 'clear', 'rain', 'clear', 'cloud'] as const)[(worldDay - 83) % 5]
  const season = worldDay < 84 ? null : (['sprout', 'sun', 'harvest', 'frost'] as const)[Math.floor((worldDay - 84) / 10) % 4]
  return { phase, weather, season, hour, timeZone: 'Asia/Tokyo' as const }
}

export const rainMirrorAvailable = (worldDay: number, now = new Date()) => {
  const climate = worldClimate(worldDay, now)
  return worldDay >= 85 && climate.weather === 'rain' && climate.phase !== 'morning'
}
