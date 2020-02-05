/* Internal Imports */
import '../setup'
import {
  manuallyDeployOvmContract,
  getUnsignedTransactionCalldata,
} from '../helpers'
import { OPCODE_WHITELIST_MASK } from '../../src/app'

/* External Imports */
import { Address } from '@pigi/rollup-core'
import { createMockProvider, deployContract, getWallets } from 'ethereum-waffle'
import { getLogger, add0x, abi, remove0x } from '@pigi/core-utils'
import { Contract, ContractFactory } from 'ethers'
import * as ethereumjsAbi from 'ethereumjs-abi'

/* Contract Imports */
import * as ExecutionManager from '../../build/contracts/ExecutionManager.json'
import * as SimpleStorage from '../../build/contracts/SimpleStorage.json'

const log = getLogger('simple-storage', true)

/*********
 * TESTS *
 *********/

describe('SimpleStorage', () => {
  const provider = createMockProvider()
  const [wallet] = getWallets(provider)
  // Create pointers to our execution manager & simple storage contract
  let executionManager: Contract
  let simpleStorage: ContractFactory
  let simpleStorageOvmAddress: Address

  /* Deploy contracts before each test */
  beforeEach(async () => {
    // Before each test let's deploy a fresh ExecutionManager and SimpleStorage
    // Deploy ExecutionManager the normal way
    executionManager = await deployContract(
      wallet,
      ExecutionManager,
      [OPCODE_WHITELIST_MASK, '0x' + '00'.repeat(20), true],
      { gasLimit: 6700000 }
    )

    // Deploy SimpleStorage with the ExecutionManager
    simpleStorageOvmAddress = await manuallyDeployOvmContract(
      wallet,
      provider,
      executionManager,
      SimpleStorage,
      [executionManager.address]
    )
    // Also set our simple storage ethers contract so we can generate unsigned transactions
    simpleStorage = new ContractFactory(
      SimpleStorage.abi as any, // For some reason the ABI type definition is not accepted
      SimpleStorage.bytecode
    )
  })

  const setStorage = async (slot, value): Promise<void> => {
    const executeCallMethodId: string = ethereumjsAbi
      .methodID('executeCall', [])
      .toString('hex')

    const timestamp: string = '00'.repeat(32)
    const origin: string = '00'.repeat(32)
    const entrypoint: string =
      '00'.repeat(12) + remove0x(simpleStorageOvmAddress)
    const txBody: string = `${executeCallMethodId}${timestamp}${origin}${entrypoint}`

    const setStorageMethodId: string = ethereumjsAbi
      .methodID('setStorage', [])
      .toString('hex')

    const innerParams: string = `${setStorageMethodId}${slot}${value}`
    // create calldata
    const data = `0x${txBody}${innerParams}`

    // Now actually apply it to our execution manager
    const tx = await wallet.sendTransaction({
      to: executionManager.address,
      data,
      gasLimit: 6_700_000,
    })

    const reciept = await provider.getTransactionReceipt(tx.hash)
    // Now make sure the SetStorage event was emitted (note it should be the 2nd event after the ActiveContract event)
    const rawSetStorageEvent = reciept.logs[1].data
    const decodedSetStorageEvent = abi.decode(
      ['address', 'bytes32', 'bytes32'],
      rawSetStorageEvent
    )
    // Make sure we got back what we expect
    decodedSetStorageEvent.should.deep.equal([
      simpleStorageOvmAddress,
      add0x(slot),
      add0x(value),
    ])
  }

  describe('setStorage', async () => {
    it('properly sets storage for the contract we expect', async () => {
      // create calldata vars
      const slot: string = '99'.repeat(32)
      const value: string = '01'.repeat(32)

      await setStorage(slot, value)
    })
  })

  describe('getStorage', async () => {
    it('correctly loads a value after we store it', async () => {
      // Create the variables we will use for set & get storage
      const slot = '99'.repeat(32)
      const value = '01'.repeat(32)

      await setStorage(slot, value)

      // Execute the getStorage CALL
      const executeCallMethodId: string = ethereumjsAbi
        .methodID('executeCall', [])
        .toString('hex')

      const timestamp: string = '00'.repeat(32)
      const origin: string = '00'.repeat(32)
      const entrypoint: string =
        '00'.repeat(12) + remove0x(simpleStorageOvmAddress)
      const txBody: string = `${executeCallMethodId}${timestamp}${origin}${entrypoint}`

      const setStorageMethodId: string = ethereumjsAbi
        .methodID('getStorage', [])
        .toString('hex')

      const innerParams: string = `${setStorageMethodId}${slot}`
      // create calldata
      const data = `0x${txBody}${innerParams}`

      // Now actually apply it to our execution manager
      const result = await executionManager.provider.call({
        to: executionManager.address,
        data,
        gasLimit: 6_700_000,
      })

      // Check the result is what we expected
      result.should.equal(add0x(value))
    })
  })
})
