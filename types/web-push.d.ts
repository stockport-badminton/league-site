// web-push ships no types. utils/push/send.js calls sendNotification only.
declare module 'web-push' {
  export function sendNotification(
    subscription: { endpoint: string, keys: { p256dh: string, auth: string } },
    payload: string,
    options: object,
  ): Promise<unknown>;
}
