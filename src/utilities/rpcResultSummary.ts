export const formatRpcStatus = (status: { name: string; code: number }): string =>
  `${status.name}(${status.code})`;

export const formatRpcTransferSummary = (
  receivedCount: number,
  elapsedMs: number,
  sentCount?: number
): string => {
  const counts = [
    ...(sentCount === undefined ? [] : [`${sentCount} Sent`]),
    `${receivedCount} Received`,
  ];
  return `${counts.join(", ")} (${(elapsedMs / 1000).toFixed(3)} sec)`;
};
