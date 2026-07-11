import { randomInt } from 'node:crypto'

const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

function randomGroup(length: number): string {
  let result = ''
  for (let i = 0; i < length; i++) {
    result += CHARS[randomInt(CHARS.length)]
  }
  return result
}

export function generatePassword(): string {
  return randomGroup(32)
}
