function generateSlidingWindowArray(till, size) {
  const arr = []
  for (let i = 0; i <= till - size + 1; i++) {
    const arrX = []
    for (let j = i; j < i + size; j++) {
      arrX.push(j)
    }
    arr.push(arrX)
  }

  return arr
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function generateDatesBetween(startTimestamp, endTimestamp) {
  const dates = []

  const startDate = new Date(startTimestamp) // Convert to milliseconds
  const endDate = new Date(endTimestamp) // Convert to milliseconds

  // Loop through each day
  for (let date = startDate; date <= endDate; date.setDate(date.getDate() + 1)) {
    const year = date.getFullYear()
    const month = (date.getMonth() + 1).toString().padStart(2, "0")
    const day = date.getDate().toString().padStart(2, "0")

    const formattedDate = `${year}-${month}-${day}`
    dates.push(formattedDate)
  }

  return dates
}

function filterPastDates(dates) {
  const currentDate = new Date() // Get the current date

  // Filter out past dates
  const filteredDates = dates.filter((date) => {
    const [year, month, day] = date.split("-").map(Number)
    const dateToCompare = new Date(year, month - 1, day) // Months are 0-based in JavaScript

    return dateToCompare < currentDate
  })

  return filteredDates
}

function calculateAverageNumberProperties(objects) {
  const propertySums = {}
  const propertyCounts = {}

  objects.forEach((obj) => {
    Object.entries(obj).forEach(([key, value]) => {
      if (typeof value === "number") {
        if (!propertySums[key]) {
          propertySums[key] = 0
          propertyCounts[key] = 0
        }
        propertySums[key] += value
        propertyCounts[key]++
      }
    })
  })

  const averages = {}

  for (const key in propertySums) {
    if (propertySums.hasOwnProperty(key)) {
      averages[key] = propertySums[key] / propertyCounts[key]
    }
  }

  return averages
}

function findMaxValues(objects) {
  const maxValues = {}

  objects.forEach((obj) => {
    Object.entries(obj).forEach(([key, value]) => {
      if (typeof value === "number") {
        if (!maxValues[key] || value > maxValues[key]) {
          maxValues[key] = value
        }
      }
    })
  })

  return maxValues
}

function linearMap(value, mapFrom, mapTo, clamp = true) {
  const slope = (mapTo.to - mapTo.from) / (mapFrom.to - mapFrom.from)
  const ans = slope * (value - mapFrom.from) + mapTo.from
  return clamp ? clampValue(ans, { min: mapTo.from, max: mapTo.from }) : ans
}

async function isClaimValid(land, _options) {
  const options = { ..._options }
  options.checkIntervals = options.checkIntervals || 5

  const geolocationResponse = await Functions.makeHttpRequest({
    url: `http://api.positionstack.com/v1/reverse?access_key=${secrets.POSITIONSTACK_API_KEY}&query=${land.location.latitude},${land.location.longitude}`,
  })

  if (geolocationResponse.error) {
    console.log("Geo Location Error")
    return -1
  }

  const geolocation = geolocationResponse.data

  const location = geolocation.data[0].locality || geolocation.data[0].region

  const dates = filterPastDates(generateDatesBetween(land.insuredFrom, land.insuredTo))

  const weatherData = []

  for (const date of dates.slice(0, 3)) {
    await sleep(100)

    const weatherDataResponse = await Functions.makeHttpRequest({
      url: `http://api.weatherapi.com/v1/history.json?key=${secrets.WEATHER_API_KEY}&q=${location}&dt=${date}`,
    })

    if (weatherDataResponse.error) {
      console.log("Weather API Error")
      return -1
    }

    const data = weatherDataResponse.data
    data.forecast.forecastday.forEach((element) => {
      weatherData.push(element.hour)
    })
  }

  const idealCropResponse = await Functions.makeHttpRequest({
    url: "https://api.npoint.io/8fb36c3096dbc24926a7",
  })

  if (idealCropResponse.error) {
    console.log("Ideal Crop API Error")
    return
  }

  const ideal = idealCropResponse.data

  const cropBest = ideal.filter(
    (item) => item.crop.toLowerCase().replace(/ /g, "") === land.cropName.toLowerCase().replace(/ /g, "")
  )[0]

  const windowSlides = generateSlidingWindowArray(
    weatherData.length - 1,
    Math.min(options.checkIntervals, Math.min(1, weatherData.length - 3))
  )

  let worstCondition = {}

  for (const window of windowSlides) {
    const avgToArr = []

    for (const i of window) {
      avgToArr.push(weatherData[i])
    }

    let arrY = []

    for (const i of avgToArr) {
      arrY.push(calculateAverageNumberProperties(i))
    }

    const diffArr = []

    for (const d of arrY) {
      diffArr.push(prefixKeysWithAvg(d), cropBest) //(calculateAbsoluteDifferenceObject(d, cropBest) as Condition);
    }

    worstCondition = findMaxValues(diffArr)
  }

  let prob = 0

  prob += clampValue(linearMap(worstCondition.avghumidity, { from: 0, to: 100 }, { from: 0, to: 15 }), {})
  prob += clampValue(linearMap(worstCondition.avgtemp_c, { from: 0, to: 50 }, { from: 0, to: 10 }), { max: 10 })
  prob += clampValue(linearMap(worstCondition.maxtemp_c, { from: 0, to: 50 }, { from: 0, to: 15 }), { max: 15 })
  prob += clampValue(linearMap(worstCondition.daily_chance_of_rain, { from: 30, to: 100 }, { from: 0, to: 10 }), {
    max: 10,
  })
  prob += clampValue(linearMap(worstCondition.maxwind_kph, { from: 0, to: 30 }, { from: 0, to: 15 }), { max: 15 })
  prob += clampValue(linearMap(worstCondition.totalsnow_cm, { from: 0, to: 50 }, { from: 0, to: 15 }), { max: 15 })
  prob += clampValue(linearMap(worstCondition.totalprecip_in, { from: 0, to: 30 }, { from: 0, to: 15 }), { max: 15 })

  return clampValue(linearMap(prob, { from: 0, to: 90 }, { from: 0, to: 100 }), { min: 0, max: 99 })
}

function prefixKeysWithAvg(obj) {
  const newObj = {}

  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const newKey = "avg" + key
      newObj[newKey] = obj[key]
    }
  }

  return newObj
}

function calculateAverageObject(objects) {
  if (objects.length === 0) {
    return null
  }

  const keys = Object.keys(objects[0])
  const result = {}

  for (const key of keys) {
    const values = objects.map((obj) => obj[key]).filter((value) => typeof value === "number")

    if (values.length > 0) {
      const sum = values.reduce((acc, value) => acc + value, 0)
      result[key] = sum / values.length
    }
  }

  return result
}

function calculateAbsoluteDifferenceObject(obj1, obj2) {
  const result = {}

  for (let key in obj1) {
    if (typeof obj1[key] === "number" && typeof obj2[key] === "number") {
      result[key] = Math.abs(obj1[key] - obj2[key])
    }
  }

  return result
}

function clampValue(value, options) {
  let ans = value

  if (options.min && ans < options.min) {
    ans = options.min
  }
  if (options.max && ans > options.max) {
    ans = options.max
  }

  return ans
}

const latitude = parseInt(args[0]) / 10 ** 6
const longitude = parseInt(args[1]) / 10 ** 6
const cropName = args[2]
const insuredFrom = parseInt(args[3]) * 1000
const insuredTo = parseInt(args[4]) * 1000

const land = {
  location: {
    latitude,
    longitude,
  },
  cropName,
  insuredFrom,
  insuredTo,
}

const prob = await isClaimValid(land, { checkIntervals: 5 })

return Functions.encodeUint256(Number(prob > 70))
