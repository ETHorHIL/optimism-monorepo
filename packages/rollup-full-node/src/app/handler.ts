/* External Imports */
import { Address } from '@pigi/rollup-core'
import { add0x, getLogger, remove0x, ZERO_ADDRESS } from '@pigi/core-utils'
import {
  convertInternalLogsToOvmLogs,
  L2ExecutionManagerContractDefinition,
} from '@pigi/ovm'

import { Contract, utils, Wallet } from 'ethers'
import { Web3Provider } from 'ethers/providers'
import { createMockProvider, deployContract, getWallets } from 'ethereum-waffle'
import * as ethereumjsAbi from 'ethereumjs-abi'

/* Internal Imports */
import {
  FullnodeHandler,
  InvalidParametersError,
  UnsupportedMethodError,
  Web3Handler,
  Web3RpcMethods,
} from '../types'

const log = getLogger('web3-handler')

const latestBlock: string = 'latest'
export class DefaultWeb3Handler implements Web3Handler, FullnodeHandler {
  /**
   * Creates a local node, deploys the L2ExecutionManager to it, and returns a
   * Web3Handler that handles Web3 requests to it.
   *
   * @param provider (optional) The web3 provider to use.
   * @returns The constructed Web3 handler.
   */
  public static async create(
    provider: Web3Provider = createMockProvider()
  ): Promise<DefaultWeb3Handler> {
    // Initialize a mock fullnode for us to interact with
    const [wallet] = getWallets(provider)
    const executionManager: Contract = await DefaultWeb3Handler.deployExecutionManager(
      wallet,
      ZERO_ADDRESS
    )

    return new DefaultWeb3Handler(provider, wallet, executionManager)
  }

  private constructor(
    private readonly provider: Web3Provider,
    private readonly wallet: Wallet,
    private readonly executionManager: Contract
  ) {}

  /**
   * Handles generic Web3 requests.
   *
   * @param method The Web3 method being requested.
   * @param params The parameters for the method in question.
   *
   * @returns The response if the method is supported and properly formatted.
   * @throws If the method is not supported or request is improperly formatted.
   */
  public async handleRequest(method: string, params: any[]): Promise<string> {
    log.debug(`Handling request, method: [${method}], params: [${params}]`)

    // Make sure the method is available
    let response: string
    let args: any[]
    switch (method) {
      case Web3RpcMethods.blockNumber:
        this.assertParameters(params, 0)
        response = await this.blockNumber()
        break
      case Web3RpcMethods.call:
        args = this.assertParameters(params, 2, latestBlock)
        response = await this.call(args[0], args[1])
        break
      case Web3RpcMethods.estimateGas:
        args = this.assertParameters(params, 2, latestBlock)
        response = await this.estimateGas(args[0], args[1])
        break
      case Web3RpcMethods.gasPrice:
        this.assertParameters(params, 0)
        response = await this.gasPrice()
        break
      case Web3RpcMethods.getCode:
        args = this.assertParameters(params, 2, latestBlock)
        response = await this.getCode(args[0], args[1])
        break
      case Web3RpcMethods.getExecutionManagerAddress:
        this.assertParameters(params, 0)
        response = await this.getExecutionManagerAddress()
        break
      case Web3RpcMethods.getTransactionCount:
        args = this.assertParameters(params, 2, latestBlock)
        response = await this.getTransactionCount(args[0], args[1])
        break
      case Web3RpcMethods.getTransactionReceipt:
        args = this.assertParameters(params, 1)
        response = await this.getTransactionReceipt(args[0])
        break
      case Web3RpcMethods.sendRawTransaction:
        args = this.assertParameters(params, 1)
        response = await this.sendRawTransaction(args[0])
        break
      case Web3RpcMethods.networkVersion:
        this.assertParameters(params, 0)
        response = await this.networkVersion()
        break
      default:
        const msg: string = `Method / params [${method} / ${params}] is not supported by this Web3 handler!`
        log.error(msg)
        throw new UnsupportedMethodError(msg)
    }

    log.debug(
      `Request: method [${method}], params: [${params}], got result: [${response}]`
    )
    return response
  }

  public async blockNumber(): Promise<string> {
    log.debug(`Requesting block number.`)
    const response = await this.provider.send(Web3RpcMethods.blockNumber, [])
    // For now we will just use the internal node's blocknumber.
    // TODO: Add rollup block tracking
    log.debug(`Received block number [${response}].`)
    return response
  }

  public async call(txObject: {}, defaultBlock: string): Promise<string> {
    log.debug(
      `Making eth_call: [${JSON.stringify(
        txObject
      )}], defaultBlock: [${defaultBlock}]`
    )
    // First get the internal calldata for our internal call
    const internalCalldata = DefaultWeb3Handler.getExecutionMgrTxData(
      txObject['to'],
      txObject['data']
    )
    // Then actually make the call and get the response
    const response = await this.provider.send(Web3RpcMethods.call, [
      {
        from: ZERO_ADDRESS,
        to: this.executionManager.address,
        data: internalCalldata,
      },
      defaultBlock,
    ])
    // Now just return the response!
    log.debug(
      `eth_call with request: [${JSON.stringify(
        txObject
      )}] default block: ${defaultBlock} got response [${response}]`
    )
    return response
  }

  public async estimateGas(
    txObject: {},
    defaultBlock: string
  ): Promise<string> {
    log.debug(
      `Estimating gas: [${JSON.stringify(
        txObject
      )}], defaultBlock: [${defaultBlock}]`
    )
    // First convert the calldata
    const internalCalldata = DefaultWeb3Handler.getExecutionMgrTxData(
      txObject['to'],
      txObject['data']
    )
    // Then estimate the gas
    const response = await this.provider.send(Web3RpcMethods.estimateGas, [
      {
        from: ZERO_ADDRESS,
        to: this.executionManager.address,
        data: internalCalldata,
      },
    ])
    log.debug(
      `Estimated gas: request: [${JSON.stringify(
        txObject
      )}] default block: ${defaultBlock} got response [${response}]`
    )
    return response
  }

  public async gasPrice(): Promise<string> {
    // Gas price is always zero
    return '0x0'
  }

  public async getCode(
    address: Address,
    defaultBlock: string
  ): Promise<string> {
    if (defaultBlock !== 'latest') {
      throw new Error('No support for historical code lookups!')
    }
    log.debug(
      `Getting code for address: [${address}], defaultBlock: [${defaultBlock}]`
    )
    // First get the code contract address at the requested OVM address
    const codeContractAddress = await this.executionManager.getCodeContractAddress(
      address
    )
    const response = await this.provider.send(Web3RpcMethods.getCode, [
      codeContractAddress,
      'latest',
    ])
    log.debug(
      `Got code for address [${address}], block [${defaultBlock}]: [${response}]`
    )
    return response
  }

  public async getExecutionManagerAddress(): Promise<Address> {
    return this.executionManager.address
  }

  public async getTransactionCount(
    address: Address,
    defaultBlock: string
  ): Promise<string> {
    log.debug(
      `Requesting transaction count. Address [${address}], block: [${defaultBlock}].`
    )
    const response = await this.provider.send(
      Web3RpcMethods.getTransactionCount,
      [address, defaultBlock]
    )
    log.debug(
      `Received transaction count for Address [${address}], block: [${defaultBlock}]: [${response}].`
    )
    return response
  }

  public async getTransactionReceipt(ovmTxHash: string): Promise<string> {
    log.debug('Getting tx receipt for ovm tx hash:', ovmTxHash)
    // First convert our ovmTxHash into an internalTxHash
    const internalTxHash = await this.getInternalTxHash(ovmTxHash)

    const internalTxReceipt = await this.provider.send(
      Web3RpcMethods.getTransactionReceipt,
      [internalTxHash]
    )
    // Now let's parse the internal transaction reciept
    const ovmTxReceipt = await this.internalTxReceiptToOvmTxReceipt(
      internalTxReceipt
    )
    log.debug(
      `Returning tx receipt for ovm tx hash [${ovmTxHash}]: [${internalTxReceipt}]`
    )
    return ovmTxReceipt
  }

  public async networkVersion(): Promise<string> {
    log.debug('Getting network version')
    const response = await this.provider.send(Web3RpcMethods.networkVersion, [])
    log.debug(`Got network version: [${response}]`)
    return response
  }

  public async sendRawTransaction(rawOvmTx: string): Promise<string> {
    log.debug('Sending raw transaction with params:', rawOvmTx)
    // Convert the OVM transaction into an "internal" tx which we can use for our execution manager
    const internalTx = await this.ovmTxToInternalTx(rawOvmTx)
    // Now compute the hash of the OVM transaction which we will return
    const ovmTxHash = await utils.keccak256(rawOvmTx)
    const internalTxHash = await utils.keccak256(internalTx)

    // Make sure we have a way to look up our internal tx hash from the ovm tx hash.
    await this.mapOvmTxHashToInternalTxHash(ovmTxHash, internalTxHash)

    // Then apply our transaction
    const returnedInternalTxHash = await this.provider.send(
      Web3RpcMethods.sendRawTransaction,
      internalTx
    )

    if (remove0x(internalTxHash) !== remove0x(returnedInternalTxHash)) {
      const msg: string = `Interal Transaction hashes do not match for OVM Hash: [${ovmTxHash}]. Calculated: [${internalTxHash}], returned from tx: [${returnedInternalTxHash}]`
      log.error(msg)
      throw Error(msg)
    }

    log.debug(`Completed send raw tx [${rawOvmTx}]. Response: [${ovmTxHash}]`)
    // Return the *OVM* tx hash. We can do this because we store a mapping to the ovmTxHashs in the EM contract.
    return ovmTxHash
  }

  /**
   * Maps the provided OVM transaction hash to the provided internal transaction hash by storing it in our
   * L2 Execution Manager contract.
   *
   * @param ovmTxHash The OVM transaction's hash.
   * @param internalTxHash Our internal transactions's hash.
   * @throws if not stored properly
   */
  private async mapOvmTxHashToInternalTxHash(
    ovmTxHash: string,
    internalTxHash: string
  ): Promise<void> {
    await this.executionManager.mapOvmTransactionHashToInternalTransactionHash(
      add0x(ovmTxHash),
      add0x(internalTxHash)
    )
  }

  private async getInternalTxHash(ovmTxHash: string): Promise<string> {
    return this.executionManager.getInternalTransactionHash(add0x(ovmTxHash))
  }

  /**
   * OVM tx to EVM tx converter
   */
  private async ovmTxToInternalTx(rawOvmTx: string): Promise<string> {
    // Decode the OVM transaction -- this will be used to construct our internal transaction
    const ovmTx = utils.parseTransaction(rawOvmTx)
    log.debug(`OVM Transaction being parsed ${JSON.stringify(ovmTx)}`)
    // Get the nonce of the account that we will use to send everything
    // Note: + 1 because all transactions will have a tx hash mapping tx sent before them.
    // TODO: Make sure we lock this function with this nonce so we don't send to txs with the same nonce
    const nonce = (await this.wallet.getTransactionCount()) + 1
    // Generate the calldata which we'll use to call our internal execution manager
    // First pull out the ovmEntrypoint (we just need to check if it's null & if so set ovmEntrypoint to the zero address as that's how we deploy contracts)
    const ovmEntrypoint = ovmTx.to === null ? ZERO_ADDRESS : ovmTx.to

    // Then construct the internal calldata
    const internalCalldata = DefaultWeb3Handler.getExecutionMgrTxData(
      ovmEntrypoint,
      ovmTx.data
    )
    // Construct the transaction
    const internalTx = {
      nonce,
      gasPrice: 0,
      gasLimit: ovmTx.gasLimit,
      to: this.executionManager.address,
      value: 0,
      data: internalCalldata,
    }
    log.debug('The internal tx:', internalTx)
    return this.wallet.sign(internalTx)
  }

  /**
   * EVM receipt to OVM receipt converter
   */
  private async internalTxReceiptToOvmTxReceipt(
    internalTxReceipt: any
  ): Promise<any> {
    const convertedOvmLogs = convertInternalLogsToOvmLogs(
      this.executionManager,
      internalTxReceipt.logs
    )

    // Construct a new receipt
    //
    // Start off with the internalTxReceipt
    const ovmTxReceipt = internalTxReceipt
    // Add the converted logs
    ovmTxReceipt.logs = convertedOvmLogs.ovmLogs
    // Update the to and from fields
    ovmTxReceipt.to = convertedOvmLogs.ovmEntrypoint
    // TODO: Update this to use some default account abstraction library potentially.
    ovmTxReceipt.from = ZERO_ADDRESS
    // Also update the contractAddress in case we deployed a new contract
    ovmTxReceipt.contractAddress = convertedOvmLogs.ovmCreatedContractAddress
    // TODO: Fix the logsBloom to remove the txs we just removed

    // Return!
    return ovmTxReceipt
  }

  /**
   * Generates the calldata for executing either a call or transaction
   */
  private static getExecutionMgrTxData(ovmEntrypoint, ovmCalldata) {
    const methodId: string = ethereumjsAbi
      .methodID('executeCall', [])
      .toString('hex')

    // TODO: make timestamp and origin actually useful.
    const timestamp: string = '00'.repeat(32)
    const origin: string = '00'.repeat(32)
    const encodedEntrypoint: string = '00'.repeat(12) + remove0x(ovmEntrypoint)
    const txBody: string = `0x${methodId}${timestamp}${origin}${encodedEntrypoint}${remove0x(
      ovmCalldata
    )}`
    return txBody
  }

  private static async deployExecutionManager(
    wallet: Wallet,
    purityCheckerContractAddress: Address
  ): Promise<Contract> {
    // Now deploy the execution manager!
    const executionManager: Contract = await deployContract(
      wallet,
      L2ExecutionManagerContractDefinition,
      [purityCheckerContractAddress, wallet.address]
    )

    log.debug(
      'Deployed execution manager to address:',
      executionManager.address
    )

    return executionManager
  }

  private assertParameters(
    params: any[],
    expected: number,
    defaultLast?: any
  ): any[] {
    if (!params) {
      if (!expected) {
        return []
      }
    } else if (params.length === expected - 1 || params.length === expected) {
      return params.length === expected ? params : [...params, defaultLast]
    }
    throw new InvalidParametersError(
      `Expected ${expected} parameters but received ${
        !params ? 0 : params.length
      }.`
    )
  }
}
