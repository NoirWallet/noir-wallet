import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { validateEnglishMnemonicWords } from '../src/core/wallet/mnemonic-validation'

const validPhrase = `${Array(23).fill('abandon').join(' ')} art`

describe('Recovery phrase validation', () => {
  test('accepts a valid 12-word BIP-39 phrase without changing its identity', () => {
    const phrase = `${Array(11).fill('abandon').join(' ')} about`
    const result = validateEnglishMnemonicWords(phrase.split(' '))
    assert.equal(result.isValid, true)
    assert.equal(result.phrase === phrase, true)
  })

  test('normalizes casing and outer word whitespace without changing the phrase', () => {
    const result = validateEnglishMnemonicWords(
      validPhrase.split(' ').map(word => ` ${word.toUpperCase()} `)
    )
    assert.equal(result.isValid, true)
    assert.equal(result.phrase === validPhrase, true)
  })

  test('rejects missing words, unsupported lengths, and reordered words', () => {
    const words = validPhrase.split(' ')
    for (const invalid of [
      [],
      words.slice(0, 23),
      [...words.slice(0, 23), ''],
      [...words].reverse()
    ]) {
      assert.equal(validateEnglishMnemonicWords(invalid).isValid, false)
    }
  })

  test('accepts a valid 24-word BIP-39 phrase', () => {
    const result = validateEnglishMnemonicWords(validPhrase.split(' '))

    assert.equal(result.isValid, true)
    assert.deepEqual(result.invalidWordIndexes, [])
  })

  test('identifies words outside the English BIP-39 word list', () => {
    const words = validPhrase.split(' ')
    words[7] = 'abandn'

    const result = validateEnglishMnemonicWords(words)

    assert.equal(result.isValid, false)
    assert.deepEqual(result.invalidWordIndexes, [7])
  })

  test('rejects an invalid checksum even when every word is in the word list', () => {
    const words = validPhrase.split(' ')
    words[23] = 'ability'

    const result = validateEnglishMnemonicWords(words)

    assert.equal(result.isValid, false)
    assert.deepEqual(result.invalidWordIndexes, [])
  })
})
