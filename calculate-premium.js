function generateNumberRange(start, end, count) {
  const step = (end - start) / (count - 1);
  const result = [];

  for (let i = 0; i < count; i++) {
    const num = start + i * step;
    result.push(num);
  }

  return result;
}

function calculateAverageObject(objects) {
  if (objects.length === 0) {
    return null;
  }

  const keys = Object.keys(objects[0]);
  const result = {};

  for (const key of keys) {
    const values = objects
      .map((obj) => obj[key])
      .filter((value) => typeof value === "number");

    if (values.length > 0) {
      const sum = values.reduce((acc, value) => acc + value, 0);
      result[key] = sum / values.length;
    }
  }

  return result;
}

function calculateAbsoluteDifferenceObject(obj1, obj2) {
  const result = {};

  for (let key in obj1) {
    if (typeof obj1[key] === "number" && typeof obj2[key] === "number") {
      result[key] = Math.abs(obj1[key] - obj2[key]);
    }
  }

  return result;
}

function clampValue(value, options) {
  let ans = value;

  if (options.min && ans < options.min) {
    ans = options.min;
  }
  if (options.max && ans > options.max) {
    ans = options.max;
  }

  return ans;
}

function convertUnixToDateFormat(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

async function getScore(land, options) {
  console.log(
    `http://api.positionstack.com/v1/reverse?access_key=${secrets.POSITIONSTACK_API_KEY}&query=${land.location.latitude},${land.location.longitude}`
  );
  const geolocationResponse = await Functions.makeHttpRequest({
    url: `http://api.positionstack.com/v1/reverse?access_key=${secrets.POSITIONSTACK_API_KEY}&query=${land.location.latitude},${land.location.longitude}`,
  });

  if (geolocationResponse.error) {
    console.log("Geo Location Error");
    return -1;
  }

  const geolocation = geolocationResponse.data;

  const location = geolocation.data[0].locality || geolocation.data[0].region;

  console.log(`this location is ${location}`);

  const weatherDataResponse = await Functions.makeHttpRequest({
    url: `http://api.weatherapi.com/v1/forecast.json?key=${
      secrets.WEATHER_API_KEY
    }&q=${location}&days=${
      options && options.days ? options.days : 7
    }&aqi=no&alerts=no`,
  });

  if (weatherDataResponse.error) {
    console.log("Weather API Error");
    return -1;
  }

  const weatherData = weatherDataResponse.data;

  const idealCropResponse = await Functions.makeHttpRequest({
    url: "https://api.npoint.io/8fb36c3096dbc24926a7",
  });

  if (idealCropResponse.error) {
    console.log("Ideal Crop API Error");
    return;
  }

  const ideal = idealCropResponse.data;

  const forecastDaysData = [];

  weatherData.forecast.forecastday.forEach((day) => {
    forecastDaysData.push(day.day);
  });

  const avgForecast = calculateAverageObject(forecastDaysData);

  const cropBest = ideal.filter(
    (item) =>
      item.crop.toLowerCase().replace(/ /g, "") ===
      land.cropName.toLowerCase().replace(/ /g, "")
  )[0];

  const difference = calculateAbsoluteDifferenceObject(avgForecast, cropBest);

  let score = 100;

  score -= clampValue(difference.avghumidity / 5, { max: 10 });
  score -= clampValue(difference.avgtemp_c, { max: 20 });
  score -= clampValue(difference.maxtemp_c, { max: 20 });
  score -= clampValue(difference.daily_chance_of_rain / 2, { max: 10 });
  //   score -= clampValue(difference.daily_will_it_rain * 10, { max: 10 });
  score -= clampValue(difference.maxwind_kph, { max: 15 });
  score -= clampValue((difference.totalsnow_cm * 3) / 5, { max: 10 });
  score -= clampValue((difference.totalprecip_in * 3) / 5, { max: 10 });

  return clampValue(score, { min: 18, max: 99 }).toFixed(2);
}

const curr = (new Date().getTime() / 1000) | 0;

const latitude = parseInt(args[0]) / 10 ** 6;
const longitude = parseInt(args[1]) / 10 ** 6;
const cropName = args[2];
const coverage = parseInt(args[3]) / 10 ** 18;
const days = Math.ceil((parseInt(args[4]) - curr) / (24 * 60 * 60));

const land = {
  location: {
    latitude,
    longitude,
  },
  cropName,
};

const score = await getScore(land, { days });

return Functions.encodeUint256(Math.round(score * 100));
// async function main() {
//   console.log(
//     `The score for this land at ${land.location.latitude}° N, ${
//       land.location.longitude
//     }° E growing ${land.cropName} is ${}`
//   );
// }

// main();
