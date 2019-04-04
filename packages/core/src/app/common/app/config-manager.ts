/* External Imports */
import { stringify, jsonify } from '../utils'
import { ConfigManager } from '../../../interfaces'
import { Service } from '@nestd/core';

/**
 * Service used for storing configuration for other services.
 */
@Service()
export class DefaultConfigManager implements ConfigManager {
  private db = new Map<string, string>()

  /**
   * Queries a value from the config.
   * @param key Key to query.
   * @returns the config value.
   */
  public get(key: string): any {
    if (!this.db.has(key)) {
      throw new Error('Key not found in configuration.')
    }

    const value = this.db.get(key)
    return jsonify(value)
  }

  /**
   * Sets a value in the config.
   * @param key Key to set.
   * @param value Value to set.
   */
  public put(key: string, value: any): void {
    const parsed = stringify(value)
    this.db.set(key, parsed)
  }
}
