export const AwsRegion = {
  afSouth1: "af-south-1",

  apEast1: "ap-east-1",

  apSouth1: "ap-south-1",
  apSouth2: "ap-south-2",

  apNortheast1: "ap-northeast-1",
  apNortheast2: "ap-northeast-2",
  apNortheast3: "ap-northeast-3",

  apSoutheast1: "ap-southeast-1",
  apSoutheast2: "ap-southeast-2",
  apSoutheast3: "ap-southeast-3",
  apSoutheast4: "ap-southeast-4",

  caCentral1: "ca-central-1",

  euCentral1: "eu-central-1",
  euCentral2: "eu-central-2",

  euNorth1: "eu-north-1",

  euWest1: "eu-west-1",
  euWest2: "eu-west-2",

  euSouth1: "eu-south-1",
  euSouth2: "eu-south-2",

  euWest3: "eu-west-3",

  meCentral1: "me-central-1",
  meSouth1: "me-south-1",

  saEast1: "sa-east-1",

  usEast1: "us-east-1",
  usEast2: "us-east-2",

  usWest1: "us-west-1",
  usWest2: "us-west-2",
} as const;
export type AwsRegion = (typeof AwsRegion)[keyof typeof AwsRegion];

export const AwsRegionValues = Object.values(AwsRegion).sort();
