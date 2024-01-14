# Database Notebook examples

This page shows an example of the use of the VS code extension "Database Notebook".

## TOC

- 1. [Query examples](#QueryExamples)
- 2. [Axios use cases](#AxiosUseCases)
  - 2.1. [GET Method](#GetMethod)
    - 2.1.1. [Simple GET request](#SimpleGetRequest)
    - 2.1.2. [Request with authorisation header](#RequestWithAuthorisationHeader)
    - 2.1.3. [GET image](#GetImage)
  - 2.2. [POST Method](#PostMethod)
  - 2.3. [PUT Method](#PutMethod)
  - 2.4. [DELETE Method](#DeleteMethod)
  - 2.7. [Handling JWT Access and Refresh Token](#HandlingJWTAccessAndRefreshTokenUsingAxios)

## 1. <a name='QueryExamples'></a>Query examples

## 2. <a name='AxiosUseCases'></a>Axios use cases

### 2.1. <a name='GetMethod'></a>Get Method

#### 2.1.1. <a name='SimpleGetRequest'></a>Simple GET request

##### Define cells.

Cell[1] "Get the requester's IP Address." in the "Javascript" language.

```js
const url = "https://httpbin.org/ip";
const res = await axios.get(url);

// Save the contents of the HttpResponse as cell output data.
writeResponseData(res);
```

##### Execution Result.

`[STATUS]`:200 OK😀 `[Content-Type]`:application/json `[Content-Length]`:28 B `[Elapsed Time]`:793 ms

```json
{
  "origin": "133.175.237.192"
}
```

#### 2.1.2. <a name='RequestWithAuthorisationHeader'></a>Request with authorisation header

##### Define cells.

Cell[1] "Specify Authorisation in the Request header and request." in the "Javascript" language.

```js
const url = "https://httpbin.org/ip";
const headers = {
  "Authorization": `Bearer ${variables.get("token")}`,
  "Content-Type": "application/json",
};
const res = await axios.get(url, { headers });

// Save the contents of the HttpResponse as cell output data.
writeResponseData(res);
```

##### Execution Result.

`[STATUS]`:200 OK😀 `[Content-Type]`:application/json `[Content-Length]`:28 B `[Elapsed Time]`:771 ms

```json
{
  "origin": "119.243.213.238"
}
```

#### 2.1.3. <a name='GetImage'></a>Get Image

##### Define cells.

Cell[1] "Specify 'arraybuffer' as responseType and preview the acquired image." in the "Javascript" language.

```js
const url = "https://www.gstatic.com/webp/gallery/1.webp";
const res = await axios.get(url, {
  responseType: "arraybuffer",
});

// Save the contents of the HttpResponse as cell output data.
writeResponseData(res);
```

##### Execution Result.

`[STATUS]`:200 OK😀 `[Content-Type]`:image/webp `[Content-Length]`:106 KB `[Elapsed Time]`:142 ms

<img style='max-width:128px;max-height:64px;' src='https://www.gstatic.com/webp/gallery/1.webp'>

### 2.2. <a name='PostMethod'></a>Post Method

### 2.3. <a name='PutMethod'></a>Put Method

### 2.4. <a name='DeleteMethod'></a>Delete Method

### 2.7. <a name='HandlingJWTAccessAndRefreshToken'></a>Handling JWT Access and Refresh Token

#### 2.7.1. Define cells.

Cell[1] Defines the shared values within the notebook in the "JSON" language.

Variables 'accessToken' and 'refreshToken' are set to be overwritten by subsequent "Javascript" cell executions, so empty characters are fine.

```json
{
  "baseUrl": "http://localhost:6100",
  "clientSecret": "uNoquxIP6fwLYa2FAqXAFwGeXv9mctrL",
  "accessToken": "",
  "refreshToken": "",
  "username": "test.user.b1",
  "password": "abc"
}
```

Cell[2] 'Retreive an access token and a refresh token and store their contents in a variable cell' in the "Javascript" language.

```js
const url = `${variables.get("baseUrl")}/realms/test-realm-99/protocol/openid-connect/token`;
const body = {
  client_id: "admin-cli",
  client_secret: variables.get("clientSecret"),
  scope: "openid",
  username: variables.get("username"),
  password: variables.get("password"),
  grant_type: "password",
};
const headers = {
  "Content-Type": "application/x-www-form-urlencoded",
};
const res = await axios.post(url, body, { headers });

// Save the contents of the HttpResponse as cell output data.
// The contents can be checked in detail by pressing the "Open response" button.
writeResponseData(res);

if (res.status === 200 && res.data?.access_token) {
  // Overwrite the value of "Access token" in the variable declaration cell.
  variablesCell.setKeyValueAtFirst("accessToken", res.data.access_token);

  // Decode the JWT (JSON Web Token) and print the contents to stdout.
  console.log("jwt=", decodeJwt(res.data.access_token));

  if (res.data?.refresh_token) {
    variablesCell.setKeyValueAtFirst("refreshToken", res.data.refresh_token);
  }
}
```

Cell[3] 'Use the refresh token to retrieve the access token again.' in the "Javascript" language.

```js
const url = `${variables.get("baseUrl")}/realms/test-realm-99/protocol/openid-connect/token`;
const body = {
  client_id: "admin-cli",
  client_secret: variables.get("clientSecret"),
  refresh_token: variables.get("refreshToken"),
  grant_type: "refresh_token",
};
const headers = {
  "Content-Type": "application/x-www-form-urlencoded",
};
const res = await axios.post(url, body, { headers });

// Save the contents of the HttpResponse as cell output data.
// The contents can be checked in detail by pressing the "Open response" button.
writeResponseData(res);

if (res.status === 200 && res.data?.access_token) {
  // Overwrite the value of "Access token" in the variable declaration cell.
  variablesCell.setKeyValueAtFirst("accessToken", res.data.access_token);

  if (res.data?.refresh_token) {
    variablesCell.setKeyValueAtFirst("refreshToken", res.data.refresh_token);
  }
}
```

#### 2.7.2. Execution Result.

Cell[1] (JSON variables cell)

```
OK: updated 6 variables
```

Cell[2] (Javascript cell)

```text
jwt= {
  header: {
    alg: 'RS256',
    typ: 'JWT',
    kid: 'QuMj-IU5p7hiaIjlFOO9GOGgb45l73yBS5zO-OYqYFs'
  },
  payload: {
    exp: 1705197837,
    iat: 1705197297,
    jti: '2effbd62-bb1b-4951-9097-8b7a8da56c76',
    iss: 'http://localhost:6100/realms/test-realm-99',
    sub: '5ec84293-5c52-4075-af34-40d357932ff7',
    typ: 'Bearer',
    azp: 'admin-cli',
    session_state: '464ce63e-e5dd-4b06-87c8-7e594525016e',
    acr: '1',
    scope: 'openid profile email',
    sid: '464ce63e-e5dd-4b06-87c8-7e594525016e',
    email_verified: true,
    name: 'fn1 ln1',
    preferred_username: 'test.user.b1',
    given_name: 'fn1',
    family_name: 'ln1',
    picture: 'https://example.com/u/1234?v=4',
    email: 'test-realm-99+testuserb1@example.com'
  }
}
```

`[STATUS]`:200 OK😀 `[Content-Type]`:application/json `[Content-Length]`:3 KB `[Elapsed Time]`:85 ms

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJRdU1qLUlVNXA3aGlhSWpsRk9POUdPR2diNDVsNzN5QlM1ek8tT1lxWUZzIn0.eyJleHAiOjE3MDUxOTc4MzcsImlhdCI6MTcwNTE5NzI5NywianRpIjoiMmVmZmJkNjItYmIxYi00OTUxLTkwOTctOGI3YThkYTU2Yzc2IiwiaXNzIjoiaHR0cDo...

ℹ️ (256/3362) Abbreviated. Push "Open resource" button to show all without abbreviation.
```

Cell[3] (Javascript cell)

`[STATUS]`:200 OK😀 `[Content-Type]`:application/json `[Content-Length]`:3 KB `[Elapsed Time]`:27 ms

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJRdU1qLUlVNXA3aGlhSWpsRk9POUdPR2diNDVsNzN5QlM1ek8tT1lxWUZzIn0.eyJleHAiOjE3MDUxOTc3MjUsImlhdCI6MTcwNTE5NzI5OCwianRpIjoiOTIwNzllOTctMjg5MS00YzI0LWFjNjItZjQzMjU1ODEzZDVmIiwiaXNzIjoiaHR0cDo...

ℹ️ (256/3362) Abbreviated. Push "Open resource" button to show all without abbreviation.
```
