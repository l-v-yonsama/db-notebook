# Database Notebook Javascript Cell examples

This page shows an example of Javascript Cell usage using the VS Code Extension "Database Notebook".

## TOC

- 1. [Console](#1-console)
- 2. [Execa](#2-execa)
  - 2.1. [Example of operating aws cognito via aws cli](#21-example-of-operating-aws-cognito-via-aws-cli)
    - 2.1.1. [Creating a user in the user pool](#211-creating-a-user-in-the-user-pool)
    - 2.1.2. [Verify the verification code](#212-verify-the-verification-code)
    - 2.1.3. [Acquisition and decoding of ID Token](#213-acquisition-and-decoding-of-id-token)
- 3. [Axios (Rest client) use cases](#3-axios-use-cases)
  - 3.1. [GET Method](#31-get-method)
    - 3.1.1. [Simple GET request](#311-simple-get-request)
    - 3.1.2. [Request with authorization header](#312-request-with-authorization-header)
    - 3.1.3. [GET image](#313-get-image)
  - 3.2. [POST Method](#32-post-method)
  - 3.3. [PUT Method](#33-put-method)
  - 3.4. [DELETE Method](#34-delete-method)
  - 3.5. [Handling JWT Access and Refresh Token](#35-handling-jwt-access-and-refresh-token)
  - 3.6. [Handling JWT Access Token and Introspection](#36-handling-jwt-access-token-and-introspection)

## 1. Console

The Console class can be used to create a simple logger with configurable output streams and can be accessed using either.

### Define cells.

```js
const data = {
  name: "John",
  H: 175,
  W: 65,
};

console.log("console.log => ", data);

console.table(data);

try {
  throw new Error("hoge");
} catch (e) {
  console.error("console.error => ", e);
}
```

### Execution Result.

```text
console.log =>  { name: 'John', H: 175, W: 65 }
┌─────────┬────────────┐
│ (index) │   Values   │
├─────────┼────────────┤
│  name   │ 'John'     │
│    H    │    175     │
│    W    │     65     │
└─────────┴────────────┘
```

```text
console.error =>  Error: hoge
```

## 2. Execa

[Execa](https://github.com/sindresorhus/execa#readme) runs commands in your script, application or library. Unlike shells, it is `optimized` for programmatic usage. Built on top of the `child_process` core module.

### 2.1. Example of operating aws cognito via aws cli

#### 2.1.1. Creating a user in the user pool

##### Define cells.

Cell[1] Defines the shared values within the notebook in the "JSON" language.

```json
{
  "CLIENT_ID": "63c35pra6tui4vlgt01234567890",
  "CLIENT_SECRET": "19d13c6ngig8krlrp5sg01h69rgt0psc0v012345678901234567890",
  "USER_NAME": "Yonsama010",
  "PASSWORD": "Passsama010!",
  "USER_POOL_ID": "ap-northeast-1_01234567890"
}
```

Cell[2] Defines the query within the notebook in the "Javascript" language.

variables.get(" + variable name + ") to get the variable.

```js
const crypto = require("crypto");

const CLIENT_ID = variables.get("CLIENT_ID");
const CLIENT_SECRET = variables.get("CLIENT_SECRET");
const USER_NAME = variables.get("USER_NAME");
const PASSWORD = variables.get("PASSWORD");

const SECRET_HASH = crypto
  .createHmac("SHA256", CLIENT_SECRET)
  .update(USER_NAME + CLIENT_ID)
  .digest("base64");
console.log("Created SECRET_HASH =", SECRET_HASH);
variablesCell.setKeyValueAtFirst("SECRET_HASH", SECRET_HASH);

const options = [
  "cognito-idp",
  "sign-up",
  "--client-id",
  CLIENT_ID,
  "--secret-hash",
  SECRET_HASH,
  "--username",
  USER_NAME,
  "--password",
  PASSWORD,
  "--user-attribute",
  "Name=gender,Value=male",
  "Name=locale,Value=en-US",
  "Name=email,Value=l01234567890@gmail.com",
];

const result = await execa("aws", options);
console.log(result.stdout);
```

##### Execution Result.

```text
OK: updated 6 variables
```

```text
Created SECRET_HASH = NEofc1v/F1mwt9lJIs0123456789001234567890EBWuE=
{
    "UserConfirmed": false,
    "CodeDeliveryDetails": {
        "Destination": "l***@g***",
        "DeliveryMedium": "EMAIL",
        "AttributeName": "email"
    },
    "UserSub": "07d42af8-90c1-700e-d06f-01234567890"
}
```

#### 2.1.2. Verify the verification code

##### Define cells.

```js
const CLIENT_ID = variables.get("CLIENT_ID");
const USER_NAME = variables.get("USER_NAME");
const SECRET_HASH = variables.get("SECRET_HASH");

const options = [
  "cognito-idp",
  "confirm-sign-up",
  "--client-id",
  CLIENT_ID,
  "--secret-hash",
  SECRET_HASH,
  "--username",
  USER_NAME,
  "--confirmation-code",
  "768535", // This is the code sent to the email
];

const result = await execa("aws", options);
console.log("Done. " + result.stdout);
```

##### Execution Result.

```text
Done.
```

#### 2.1.3. Acquisition and decoding of ID Token

##### Define cells.

```js
const CLIENT_ID = variables.get("CLIENT_ID");
const USER_NAME = variables.get("USER_NAME");
const PASSWORD = variables.get("PASSWORD");
const SECRET_HASH = variables.get("SECRET_HASH");
const USER_POOL_ID = variables.get("USER_POOL_ID");

const options = [
  "cognito-idp",
  "admin-initiate-auth",
  "--user-pool-id",
  USER_POOL_ID,
  "--client-id",
  CLIENT_ID,
  "--auth-flow",
  "ADMIN_NO_SRP_AUTH",
  "--auth-parameters",
  `USERNAME=${USER_NAME},PASSWORD=${PASSWORD},SECRET_HASH=${SECRET_HASH}`,
];

const result = await execa("aws", options);
console.log(result.stdout);

if (result.stdout) {
  // See. https://jmespath.org/tutorial.html
  const idToken = jmespath.search(JSON.parse(result.stdout), "AuthenticationResult.IdToken");
  console.log("Decoded id token payload=", decodeJwt(idToken).payload);
}
```

##### Execution Result.

```js
{
    "ChallengeParameters": {},
    "AuthenticationResult": {
        "AccessToken": "eyJraWQiOiJCOTMwSUJjQWtFTTVCSGlNTzQzS1lhRjhMNzFnYUF5dDZIZlNpclY5QjBzPSIsImFsZyI6IlJTMjU2In0.eyJzdWIiOiIwN2Q0MmFmOC05MGMxLTcwMGUtZDA2Zi1kYWZhYTU1NmQxY2MiLCJpc3MiOiJodHRwczpcL1wvY29nbml0by1pZHAuYXAtbm9ydGhlYXN0LTEuYW1hem9uYXdzLmNvbVwvYXAtbm9ydGhlYXN0LTFfNkIwSklLbEpQIiwiY2xpZW50X2lkIjoiNjNjMzVwcmE2dHVpNHZsZ3QwNm5yOGxhMmYiLCJvcmlnaW5fanRpIjoiYTc3MGE3YWUtMTU2MC00MmViLWI5YzQtNzRmMzJiYzllMTI0IiwiZXZlbnRfaWQiOiI0NjllZjkzNS03ZmI2LTQ3MmYtOWNiMy1hNjRlNTg4ZjAwOTciLCJ0b2tlbl91c2UiOiJhY2Nlc3MiLCJzY29wZSI6ImF3cy5jb2duaXRvLnNpZ25pbi51c2VyLmFkbWluIiwiYXV0aF90aW1lIjoxNzI5Mzc4MzYwLCJleHAiOjE3MjkzODE5NjAsImlhdCI6MTcyOTM3ODM2MCwianRpIjoiNTc4MzJjYTItNTM1ZS00YmUyLWExNzctNjQ5Y2M3NjdjOTIyIiwidXNlcm5hbWUiOiJ5b25zYW1hMDEwIn0.kK15aVRxO585VFzlzi4GX1PvG40nLZcCWYKJ7auYMfRh-Hm7ftwP0ynNwVqN2I6PJ5whZCvEaXFXg6N6bW5TuXe35PvikyNdNB3hN8PiH0O61bYH17XO2hfhYEz6QiiWj0HCbDAhMglf1xlF-sBp-QpYUD_m_d2GtMWfuIm2HgCxoCL_XimFoACXJyEN1ClO0AbRXoUNmwnN02xLPaFRcopvwO1n_cOLO-B-kAD9WKs-WKGzSSfpMVJddlf_b_s1tZGXxE68YCFUf53n4y50440synmrHy-gYBQHJhamaTt3B2OYJNDfFbBqGyOM94sstQXXcR8WraMzwkoamxIqtA",
        "ExpiresIn": 3600,
        "TokenType": "Bearer",
        "RefreshToken": "eyJjdHkiOiJKV1QiLCJlbmMiOiJBMjU2R0NNIiwiYWxnIjoiUlNBLU9BRVAifQ.mo62SlPSWeIa8CknPkCZVtldeOQYav4QkBdEpYSs6ABz7R-3cpuwrxESxNyAMYdG0b-IfwmWm5GAlkWiKkwkD6BtkfTeY7Epn2YSnJbtuFkw1pW8xl_mc7KsW5p9b-W6-sZdC1JabAbOeJWbcuZPNxaa3RB85X8ZmdRR3Znu9v50kIKGVH4cAEtFeEDls7-UTaXVHDJDoiIwLQB3TDQsttUduX5WS__ludc8RQ5jKMAE7-aA4nrftqKEDIC9Rt0hzQv1J93NWWWWP-Qjazrrt53shY8exmeG2CbFrwK-kQmVoSXK7dnXObtLVfumLx_7Wg-v2nBvlZVmlM1Ail4gMw.arKAs61kxq-5_IO3.VYEsv7eD_ZtHQGD6M-c1KVnNCLkzLk0KkgWpo9xKS81Nzl36sYuJOg2bbFuf4QCEtRB9HsEyXfVh_AHUACcQGFg1Y3tJde5b7y27LHy2c3SBRyGVOPQf7K1GrhnB9XH659JRSZlpj3PdHWfHv5MBlWZV4F3HjDKHjRpsSEyscwUDms2au0nF9VeFu_uIR64AWsFTbkx2nNCD5p-DTOdLwnSScf34s7e8-HQ1uS6TU_pNu29rojJirdHekXqn8lW0JEAE98NYsn8KkU0qdodXnYr2lj_oW8pO8bOMSn2Mv9_K2VyipJ4pCoEdWsSJbX56Lt_vtNYJ8VVB38rKdP95yfIueac-WszMr_tpMtlQJng5P65hFJvTrM-_bBJAwuaVZBO_h3NDdVwgirhgfC5gT2ceiExnE_v5AFTGDjcqfwPpoRHocjJeth4Cfcql9CfpgTT4N9gHXKnWfE8nO-1sPftC7_jzKmEXUH32BModhlI9xqUN1_6clyzPRURloD1SPYa6qrGUdDh31RfoQJAn4iXCp8JVEujOcIiahZvZd_B2Yr-SqMbCKcMzApQY5lHRaLamui5NDoquTV1WE2XSRytz4VKMa_4h4zP0BavWZr1aeUALdHLN_3oPmWCjp78jQEIzjybTFdIUct3jYlB_D4vBbNZS7GyW6jfZ9QCx8jVBm_2i_nELNupXwU-ZEsvBDD0sftw_XKGHgQ21CD9JLHJCK9K6eCdPgK2ADtNY2qFuvvdCgO_5_aDkngwcJ_ZPU4aTok_bpTl9I8vapAHP0rcXGHzHUnOnRwlByf7YLLRKE3He4RJMsCkgwWm9Cu8sS2TC-Cbz-dCKcqmmNM0KGLQLbTDFZZnkrR3_Ej_0XMrjgOvL9ZWS0wGm7UYXuoBk1VSrBTcsVp0w1idZJYvySCQpQNkzc20MNWSbjETAjS_FkxznCGFmUYyoP0Y_uR-gZRc9nA2GQqAfJV4lUU1Pa0VPtuj5bmZHr6oyENZYL-mLfQpRmHUwEVED9F5M_SQzcclVeQYPOyLnM0MrDB2994aQ4ZGgMu942Emaak12363kD14S4bebMdH8tKx54cvpHHFgBnaSckhdveJR7ex_Z4vB1wu6DWJhneBrIkbVDEeejcHzOLjRs8cKgSvfAxbBt7-miNvSQdUeHYXz7B4uoQATF8B-41jT3w_RPBs-7nH6BQgrqP0_6eKRAo5AnReXE6NAlgpBC60ZM9FNa63HlIu0P8FDcYEi2PSTlyV0YgBU75LL0u-E2DdiwMU4z6tPTp1txgMaVP5WhmVrP62W_MZ4YeWN2_s.Iz-fNtKwz27-uXoN7eWI_A",
        "IdToken": "eyJraWQiOiJBdXdoUzhua1lVaXQ0T2VYQnBvd3lKSE53Qks1bDRxVWJNZzhhZ2hhQjNNPSIsImFsZyI6IlJTMjU2In0.eyJzdWIiOiIwN2Q0MmFmOC05MGMxLTcwMGUtZDA2Zi1kYWZhYTU1NmQxY2MiLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwiZ2VuZGVyIjoibWFsZSIsImlzcyI6Imh0dHBzOlwvXC9jb2duaXRvLWlkcC5hcC1ub3J0aGVhc3QtMS5hbWF6b25hd3MuY29tXC9hcC1ub3J0aGVhc3QtMV82QjBKSUtsSlAiLCJjb2duaXRvOnVzZXJuYW1lIjoieW9uc2FtYTAxMCIsImxvY2FsZSI6ImVuLVVTIiwib3JpZ2luX2p0aSI6ImE3NzBhN2FlLTE1NjAtNDJlYi1iOWM0LTc0ZjMyYmM5ZTEyNCIsImF1ZCI6IjYzYzM1cHJhNnR1aTR2bGd0MDZucjhsYTJmIiwiZXZlbnRfaWQiOiI0NjllZjkzNS03ZmI2LTQ3MmYtOWNiMy1hNjRlNTg4ZjAwOTciLCJ0b2tlbl91c2UiOiJpZCIsImF1dGhfdGltZSI6MTcyOTM3ODM2MCwiZXhwIjoxNzI5MzgxOTYwLCJpYXQiOjE3MjkzNzgzNjAsImp0aSI6IjE3NDEzZThjLWUxYjgtNDM3Mi05ZTkwLTE0YjJjODM2NjQ3ZCIsImVtYWlsIjoibC52Lnlvc2hpb2thKzAxMEBnbWFpbC5jb20ifQ.21qD_bAXlqsRS38DHodO74_mXV71ni_YjoRjIx2u02wmSZEqEJV-ufK7G8rtK4QfPoPFX1jFaas88kZ8POIbE_quqZ8OW6BQX1_oWCN4Fx668cd8ZQp1yZ3kKxJdYQh7JHCvNiDWBVEd8zgqN66VSuCfteyyouPBS96UrUffajYm4H3RVwF4s_A2CCEd8qywDQsi7q3PZ5dcq-klUOap64esRrz7rF4f83c79S3_c2ppnOaEDWBmmMZT7shxwm8pCPXcCY8paWYGu-gDySy2IXSqc8mpQkSNU5pRxjSq0EvgObV87CMYG2TK5ltHKT5_qgmSYwkRtJgFM7bVm7PCcg"
    }
}
Decoded id token payload= {
  sub: '07d42af8-90c1-700e-d06f-dafaa556d1cc',
  email_verified: true,
  gender: 'male',
  iss: 'https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_XXXXX',
  'cognito:username': 'yonsamaXXXXX',
  locale: 'en-US',
  origin_jti: 'a770a7ae-1560-42eb-b9c4-74f32bc9e124',
  aud: '63c35pra6tui4vlgt06nrXXXXX',
  event_id: '469ef935-7fb6-472f-9cb3-a64e588f0097',
  token_use: 'id',
  auth_time: 1729378360,
  exp: 1729381960,
  iat: 1729378360,
  jti: '17413e8c-e1b8-4372-9e90-14b2c836647d',
  email: 'l.XXXXX@gmail.com'
}
```

## 3. Axios use cases

### 3.1. Get Method

#### 3.1.1. Simple GET request

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

#### 3.1.2. Request with authorization header

##### Define cells.

Cell[1] "Specify Authorization in the Request header and request." in the "Javascript" language.

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

#### 3.1.3. Get Image

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

### 3.2. Post Method

##### Define cells.

Cell[1] "Post data in json format." in the "Javascript" language.

```js
const url = "https://httpbin.org/post";
const body = { a: 1, b: "aa" };
const headers = {
  //  'Authorization': `Bearer ${variables.get('token')}`,
  "Content-Type": "application/json",
};
const res = await axios.post(url, body, { headers });

// Save the contents of the HttpResponse as cell output data.
writeResponseData(res);
```

##### Execution Result.

`[STATUS]`:200 OK😀 `[Content-Type]`:application/json `[Content-Length]`:418 B `[Elapsed Time]`:871 ms

```json
{
  "args": {},
  "data": "{\"a\":1,\"b\":\"aa\"}",
  "files": {},
  "form": {},
  "headers": {
    "Accept": "application/json, text/plain, */*",
    "Accept-Encoding": "gzip, compress, deflate, br",
    "Content-Length": "16",
    "Content-Type": "applic...

ℹ️ (256/511) Abbreviated. Push "Open response" button to show all without abbreviation.
```

### 3.3. Put Method

##### Define cells.

Cell[1] "Put data in json format." in the "Javascript" language.

```js
const url = "https://httpbin.org/put";
const body = { a: 1, b: "aa" };
const headers = {
  //  'Authorization': `Bearer ${variables.get('token')}`,
  "Content-Type": "application/json",
};
const res = await axios.put(url, body, { headers });

// Save the contents of the HttpResponse as cell output data.
writeResponseData(res);
```

##### Execution Result.

`[STATUS]`:200 OK😀 `[Content-Type]`:application/json `[Content-Length]`:417 B `[Elapsed Time]`:846 ms

```json
{
  "args": {},
  "data": "{\"a\":1,\"b\":\"aa\"}",
  "files": {},
  "form": {},
  "headers": {
    "Accept": "application/json, text/plain, */*",
    "Accept-Encoding": "gzip, compress, deflate, br",
    "Content-Length": "16",
    "Content-Type": "applic...

ℹ️ (256/510) Abbreviated. Push "Open response" button to show all without abbreviation.
```

### 3.4. Delete Method

##### Define cells.

Cell[1] "Delete the resouce." in the "Javascript" language.

```js
const url = "https://httpbin.org/delete";
const headers = {
  //  'Authorization': `Bearer ${variables.get('token')}`,
  "Content-Type": "application/json",
};
const res = await axios.delete(url, { headers });
writeResponseData(res);
```

##### Execution Result.

`[STATUS]`:200 OK😀 `[Content-Type]`:application/json `[Content-Length]`:364 B `[Elapsed Time]`:815 ms

```json
{
  "args": {},
  "data": "",
  "files": {},
  "form": {},
  "headers": {
    "Accept": "application/json, text/plain, */*",
    "Accept-Encoding": "gzip, compress, deflate, br",
    "Content-Type": "application/json",
    "Host": "httpbin.org",
    "User-...

ℹ️ (256/436) Abbreviated. Push "Open response" button to show all without abbreviation.
```

### 3.5. Handling JWT Access and Refresh Token

#### 2.5.1. Define cells.

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

#### 2.5.2. Execution Result.

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

### 3.6. Handling JWT Access Token and Introspection

#### 3.6.1. Define cells.

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

Cell[3] 'Introspect the access token.' in the "Javascript" language.

```js
const url = `${variables.get(
  "baseUrl"
)}/realms/test-realm-99/protocol/openid-connect/token/introspect`;
const body = {
  token: variables.get("accessToken"),
  token_type_hint: "access_token",
};
const headers = {
  "Content-Type": "application/x-www-form-urlencoded",
};
const auth = {
  username: "admin-cli",
  password: variables.get("clientSecret"),
};
const res = await axios.post(url, body, { auth, headers });
writeResponseData(res);
```

#### 3.6.2. Execution Result.

Cell[1] (JSON variables cell)

```
OK: updated 6 variables
```

Cell[2] (Javascript cell)

`[STATUS]`:200 OK😀 `[Content-Type]`:application/json `[Content-Length]`:3 KB `[Elapsed Time]`:87 ms

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJRdU1qLUlVNXA3aGlhSWpsRk9POUdPR2diNDVsNzN5QlM1ek8tT1lxWUZzIn0.eyJleHAiOjE3MDU0OTI0NTMsImlhdCI6MTcwNTQ5MTkxMywianRpIjoiMWFjODAzYTYtNGU4My00MTJhLThhYjEtY2I2Y2I4MDU1ZjYxIiwiaXNzIjoiaHR0cDo...

ℹ️ (256/3362) Abbreviated. Push "Open response" button to show all without abbreviation.
```

Cell[3] (Javascript cell)

`[STATUS]`:200 OK😀 `[Content-Type]`:application/json `[Content-Length]`:618 B `[Elapsed Time]`:17 ms

```json
{
  "exp": 1705492453,
  "iat": 1705491913,
  "jti": "1ac803a6-4e83-412a-8ab1-cb6cb8055f61",
  "iss": "http://localhost:6100/realms/test-realm-99",
  "sub": "5ec84293-5c52-4075-af34-40d357932ff7",
  "typ": "Bearer",
  "azp": "admin-cli",
  "session_state":...

ℹ️ (256/703) Abbreviated. Push "Open response" button to show all without abbreviation.
```
