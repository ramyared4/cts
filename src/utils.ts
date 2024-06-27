import axios, { AxiosRequestConfig } from 'axios';
// import * as https from 'https';
// import { timeout } from 'rxjs';
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
export function contains(str, arr) {
  return (arr.some(element => {
    if (str?.includes(element)) {
      return true;
    }
    return false;
  }))
};


export async function fetchWithTimeout(resource: string, options: AxiosRequestConfig = {}, maxRetries = 0) {
  options.timeout = options.timeout || 50000;
  options.method = options.method || 'GET';

  for (let retryCount = 0; retryCount <= maxRetries; retryCount++) {
    const source = axios.CancelToken.source();
    const id = setTimeout(() => {
      source.cancel(`Request timed out after ${options.timeout}ms`);
    }, options.timeout);

    try {
      const response = await axios.request({
        ...options,
        url: resource,
        headers: { 'Content-Type': 'application/json' },
        cancelToken: source.token
      });
      clearTimeout(id);
      return response;
    } catch (error) {
      clearTimeout(id);
      console.log("Error at URL: ", resource);
      parseError(error);
      if (axios.isCancel(error)) {
        console.log('Request canceled:', error.message, resource);
        break;  // No point in retrying if request was cancelled due to timeout
      }
      if (retryCount < maxRetries) {
        console.log(`Retrying... (${retryCount + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 seconds delay
      } else {
        console.log(`All ${maxRetries + 1} retries failed for ${resource}`);
        return undefined;
      }
    }
  }
}

export function toBoolean(value: string | number | boolean): boolean {
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  if (typeof value === 'number') {
    return value === 1;
  }
  return value
}

export function fetchNumbersFromString(inputString) {
  const regex = /\d+/g;
  const matches = inputString.match(regex);
  if (matches) {
    const result = matches.join('');
    return result;
  } else {
    return '';
  }
}

export function parseError(
  err,
  prefix = 'TgCms',
) {
  let status = 'UNKNOWN';
  let message = 'An unknown error occurred';
  let error = 'UnknownError';

  const extractMessage = (data) => {
    if (Array.isArray(data)) {
      const messages = data.map((item) => extractMessage(item));
      return messages.filter((message) => message !== undefined).join(', ');
    } else if (typeof data === 'string') {
      return data;
    } else if (typeof data === 'object' && data !== null) {
      let resultString = ''
      for (const key in data) {
        const value = data[key]
        if (Array.isArray(data[key]) && data[key].every(item => typeof item === 'string')) {
          resultString = resultString + data[key].join(', ');
        } else {
          const result = extractMessage(value);
          if (result) {
            resultString = resultString + result;
          }
        }
      }
      return resultString
    }
    return JSON.stringify(data);
  };

  if (err.response) {
    const response = err.response;
    status =
      response.data?.status ||
      response.status ||
      err.status ||
      'UNKNOWN';
    message =
      response.data?.message ||
      response.data?.errors ||
      response.message ||
      response.statusText ||
      response.data ||
      err.message ||
      'An error occurred';
    error =
      response.data?.error ||
      response.error ||
      err.name ||
      err.code ||
      'Error';
  } else if (err.request) {
    status = err.status || 'NO_RESPONSE';
    message = err.data?.message ||
      err.data?.errors ||
      err.message ||
      err.statusText ||
      err.data ||
      err.message || 'The request was triggered but no response was received';
    error = err.name || err.code || 'NoResponseError';
  } else if (err.message) {
    status = err.status || 'UNKNOWN';
    message = err.message;
    error = err.name || err.code || 'Error';
  } else if (err.errorMessage) {
    status = err.status || 'UNKNOWN';
    message = err.errorMessage;
    error = err.name || err.code || 'Error';
  }

  const msg = `${prefix ? `${prefix} ::` : ""} ${extractMessage(message)} `

  const resp = { status, message: msg, error };
  console.log(resp);
  return resp
}

let botCount = 0
export const ppplbot = () => {
  let token;
  if (botCount % 2 == 1) {
    token = `bot6624618034:AAHoM3GYaw3_uRadOWYzT7c2OEp6a7A61mY`
  } else {
    token = `bot6607225097:AAG6DJg9Ll5XVxy24Nr449LTZgRb5bgshUA`
  }

  return `https://api.telegram.org/${token}/sendMessage?chat_id=-1001801844217`
}

export const defaultReactions = [
  '❤', '🔥', '👏', '🥰', '😁', '🤔',
  '🤯', '😱', '🤬', '😢', '🎉', '🤩',
  '🤮', '💩', '🙏', '👌', '🕊', '🤡',
  '🥱', '🥴', '😍', '🐳', '❤‍🔥', '💯',
  '🤣', '💔', '🏆', '😭', '😴', '👍',
  '🌚', '⚡', '🍌', '😐', '💋', '👻',
  '👀', '🙈', '🤝', '🤗', '🆒',
  '🗿', '🙉', '🙊', '🤷', '👎'
]
export const defaultMessages = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18"];
