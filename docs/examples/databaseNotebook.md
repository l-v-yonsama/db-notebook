# Database Notebook examples

This page shows an example of the use of the VS code extension "Database Notebook".

## TOC

- 1. [Query examples](#1-query-examples)
- 2. [Axios use cases](#2-axios-use-cases)
  - 2.1. [GET Method](#21-get-method)
    - 2.1.1. [Simple GET request](#211-simple-get-request)
    - 2.1.2. [Request with authorisation header](#212-request-with-authorisation-header)
    - 2.1.3. [GET image](#213-get-image)
  - 2.2. [POST Method](#22-post-method)
  - 2.3. [PUT Method](#23-put-method)
  - 2.4. [DELETE Method](#24-delete-method)
  - 2.5. [Handling JWT Access and Refresh Token](#25-handling-jwt-access-and-refresh-token)
  - 2.6. [Handling JWT Access Token and Introspection](#26-handling-jwt-access-token-and-introspection)

## 1. Query examples

## 2. Axios use cases

### 2.1. Get Method

#### 2.1.1. Simple GET request

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

#### 2.1.2. Request with authorisation header

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

#### 2.1.3. Get Image

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

### 2.2. Post Method

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

### 2.3. Put Method

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

### 2.4. Delete Method

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

### 2.5. Handling JWT Access and Refresh Token

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

### 2.6. Handling JWT Access Token and Introspection

#### 2.6.1. Define cells.

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

#### 2.6.2. Execution Result.

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
