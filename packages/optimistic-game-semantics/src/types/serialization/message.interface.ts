/* External Imports */
import { BigNumber } from '@eth-optimism/core-utils'

export interface SignedMessage {
  signature: string
  serializedMessage: string
}

export interface Message {
  channelID: string
  nonce?: BigNumber
  data: {}
}

export interface ParsedMessage {
  sender: string
  recipient: string
  message: Message
  signatures: Signatures
}

export interface Signatures {
  [address: string]: string
}
