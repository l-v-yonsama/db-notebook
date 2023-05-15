export type AwsSQSAttributes = {
  DelaySeconds?: number;
  MaximumMessageSize?: number;
  MessageRetentionPeriod?: number;
  Policy?: any;
  ReceiveMessageWaitTimeSeconds?: number;
  VisibilityTimeout?: number;
  RedrivePolicy?: any;
  RedriveAllowPolicy?: any;
  ContentBasedDeduplication?: boolean;
  DeduplicationScope?: any;
  FifoThroughputLimit?: any;
  FifoQueue?: boolean;
  ApproximateNumberOfMessages?: number;
  ApproximateNumberOfMessagesNotVisible?: number;
  ApproximateNumberOfMessagesDelayed?: number;
  [key: string]: any;
};
