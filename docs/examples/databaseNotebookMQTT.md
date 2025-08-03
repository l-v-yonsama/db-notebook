# Database Notebook MQTT examples

This page shows an example of MQTT usage using the VS Code Extension "Database Notebook".

## TOC

- [Screenshot](#screenshot)
- 1. [Setup](#1-setup)
- 2. [Publish](#2-publish)
- 3. [Show subscription payloads](#3-show-subscription-payloads)

## Screenshot

- ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/21_mqtt.gif)

## 1. Setup

## 1.1. Create Connection Setting

- Database type: Mqtt(experimental)
- Connection name: mosquittoMqtt
- Protocol: mqtt
- Protocol-version: v3.1.1
- Host: test.mosquitto.org
- Port: 1833

## 1.2. Connect

Connect to mosquitto server.

## 1.3. Subscribe

### 1.3.1. Create New subscription

| Name          | QoS | No Local | Retain As Published | Retain Handling |
| :------------ | :-- | :------- | :------------------ | :-------------- |
| device/topic  | 1   | false    | false               | 0               |
| device/piyo/# | 1   | false    | false               | 0               |

## 2. Publish

## 2.1. Publish to 'device/topic'

### Define cells

```json
{
  "message": "This is a dummy message for device/topic",
  "value": 90,
  "ok": true
}
```

#### Define cell metadata

- language: JSON
- topic: device/topic
- type: MQTT JSON
- QOS: 0
- Retain: false

### Execution Result

`[Result]` [Elapsed Time]:0 ms [Payload Length]:89

## 2.2. Publish to 'device/piyo/1st'

### Define cells

```json
{
  "message": "This is a dummy message for device/piyo/1st",
  "value": 350,
  "ok": false
}
```

#### Define cell metadata

- language: JSON
- topic: device/piyo/1st
- type: MQTT JSON
- QOS: 1
- Retain: false

### Execution Result.

`[Result]` [Elapsed Time]:483 ms [Payload Length]:94

## 2.3. Publish to 'device/piyo/1st'.

### Define cells.

```js
const topicName = "device/piyo/1st";

const { ok, message, result } = await DBDriverResolver.getInstance().workflow(
  getConnectionSettingByName("mosquittoMqtt"),
  async (driver) => {
    let startTime = new Date().getTime();
    for (let i = 0; i < 3; i++) {
      const payload = {
        message: `dummy_${i}`,
        value: 7 * i,
        ok: i % 2 === 0,
      };

      await driver.publish(topicName, JSON.stringify(payload), {
        qos: 1,
        retain: false,
      });
    }
    return `elapsedTime: ${new Date().getTime() - startTime}msec`;
  }
);
console.log("ok", ok);
console.log("message", message);
console.log("result", result);
```

#### Define cell metadata

- language: JavaScript

### Execution Result.

```text
ok true
message
result elapsedTime: 824msec
```

## 3. Show subscription payloads

## 3.1. Simple query to 'device/topic'

### Define cells.

```sql
SELECT
  *,
  json_extract(payload, '$.value') as payloadValue
FROM
  "device/topic"
```

#### Define cell metadata

- Expand JSON Column: false

### Execution Result.

`[Query Result]` 1 row in set (0.01 sec)

| timestamp           | qos     | retained | messageId | payload                                                                     | payloadValue |
| :------------------ | :------ | :------- | :-------: | :-------------------------------------------------------------------------- | :----------- |
| TEXT                | INTEGER | INTEGER  |  UNKNOWN  | TEXT                                                                        | INTEGER      |
| 2025-08-02 22:51:21 | 0       | 0        |  `NULL`   | {"message":"This is a dummy message for device/topic","value":90,"ok":true} | 90           |

## 3.2. Query to 'device/piyo/#'

### Define cells.

```sql
SELECT
  *,
  json_extract(payload, '$.message') as payloadMessage,
  json_extract(payload, '$.value') as payloadValue
FROM
  "device/piyo/#"
WHERE
  payloadValue >= 0
ORDER BY
  payloadValue DESC
```

#### Define cell metadata

- Expand JSON Column: false

### Execution Result.

`[Query Result]` 4 rows in set (0.01 sec)

| timestamp           | qos     | retained | messageId | payload                                                                          | payloadMessage                              | payloadValue |
| :------------------ | :------ | :------- | :-------- | :------------------------------------------------------------------------------- | :------------------------------------------ | :----------- |
| TEXT                | INTEGER | INTEGER  | TEXT      | TEXT                                                                             | TEXT                                        | INTEGER      |
| 2025-08-02 22:58:48 | 1       | 0        | 1         | {"message":"This is a dummy message for device/piyo/1st","value":350,"ok":false} | This is a dummy message for device/piyo/1st | 350          |
| 2025-08-02 22:58:52 | 1       | 0        | 4         | {"message":"dummy_2","value":14,"ok":true}                                       | dummy_2                                     | 14           |
| 2025-08-02 22:58:52 | 1       | 0        | 3         | {"message":"dummy_1","value":7,"ok":false}                                       | dummy_1                                     | 7            |
| 2025-08-02 22:58:52 | 1       | 0        | 2         | {"message":"dummy_0","value":0,"ok":true}                                        | dummy_0                                     | 0            |

## 3.3. Query to 'device/piyo/#' (JSON expansion)

### Define cells.

```sql
SELECT
  *,
  "EX:str" as str
FROM
  "device/piyo/#"
WHERE
  "EX:ok" = 1
ORDER BY
  "EX:value" DESC
```

#### Define cell metadata

- Expand JSON Column: true

### Execution Result.

`[Query Result]` 2 rows in set (0.01 sec)

| timestamp           | qos     | retained | messageId | EX:message | EX:value | EX:ok   | str    |
| :------------------ | :------ | :------- | :-------- | :--------- | :------- | :------ | :----- |
| TEXT                | INTEGER | INTEGER  | TEXT      | TEXT       | INTEGER  | INTEGER | TEXT   |
| 2025-08-02 22:58:52 | 1       | 0        | 4         | dummy_2    | 14       | 1       | EX:str |
| 2025-08-02 22:58:52 | 1       | 0        | 2         | dummy_0    | 0        | 1       | EX:str |
