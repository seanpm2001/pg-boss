const delay = require('delay')
const assert = require('assert')
const helper = require('./testHelper')
const pMap = require('p-map')

describe('failure', function () {
  it('should reject missing id argument', async function () {
    const boss = this.test.boss = await helper.start(this.test.bossConfig)

    try {
      await boss.fail()
      assert(false)
    } catch (err) {
      assert(err)
    }
  })

  it('should fail a job when requested', async function () {
    const boss = this.test.boss = await helper.start(this.test.bossConfig)
    const queue = this.test.bossConfig.schema

    await boss.send(queue)

    const job = await boss.fetch(queue)

    await boss.fail(job.id)
  })

  it('worker for job failure', async function () {
    const boss = this.test.boss = await helper.start(this.test.bossConfig)
    const queue = this.test.bossConfig.schema

    const jobId = await boss.send(queue, null, { onComplete: true })

    const job = await boss.fetch(queue)

    await boss.fail(job.id)

    return new Promise((resolve, reject) => {
      boss.onComplete(queue, async job => {
        assert.strictEqual(jobId, job.data.request.id)
        assert.strictEqual('failed', job.data.state)
        resolve()
      }).catch(reject)
    })
  })

  it('should fail a batch of jobs', async function () {
    const boss = this.test.boss = await helper.start(this.test.bossConfig)
    const queue = this.test.bossConfig.schema

    await Promise.all([
      boss.send(queue),
      boss.send(queue),
      boss.send(queue)
    ])

    const jobs = await boss.fetch(queue, 3)

    await boss.fail(jobs.map(job => job.id))
  })

  it('should fail a batch of jobs with a data arg', async function () {
    const boss = this.test.boss = await helper.start(this.test.bossConfig)
    const queue = this.test.bossConfig.schema
    const message = 'some error'

    await Promise.all([
      boss.send(queue),
      boss.send(queue),
      boss.send(queue)
    ])

    const jobs = await boss.fetch(queue, 3)

    await boss.fail(jobs.map(job => job.id), new Error(message))

    const results = await pMap(jobs, job => boss.getJobById(job.id))

    assert(results.every(i => i.output.message === message))
  })

  it('should accept a payload', async function () {
    const boss = this.test.boss = await helper.start(this.test.bossConfig)
    const queue = this.test.bossConfig.schema

    const failPayload = { someReason: 'nuna' }

    const jobId = await boss.send(queue, null, { onComplete: true })

    await boss.fail(jobId, failPayload)

    const job = await boss.fetchCompleted(queue)

    assert.strictEqual(job.data.state, 'failed')
    assert.strictEqual(job.data.response.someReason, failPayload.someReason)
  })

  it('should preserve nested objects within a payload that is an instance of Error', async function () {
    const boss = this.test.boss = await helper.start(this.test.bossConfig)
    const queue = this.test.bossConfig.schema

    const failPayload = new Error('Something went wrong')
    failPayload.some = { deeply: { nested: { reason: 'nuna' } } }

    const jobId = await boss.send(queue, null, { onComplete: true })

    await boss.fail(jobId, failPayload)

    const job = await boss.fetchCompleted(queue)

    assert.strictEqual(job.data.state, 'failed')
    assert.strictEqual(job.data.response.some.deeply.nested.reason, failPayload.some.deeply.nested.reason)
  })

  it('failure via done() should pass error payload to failed job', async function () {
    const boss = this.test.boss = await helper.start(this.test.bossConfig)
    const queue = this.test.bossConfig.schema
    const errorMessage = 'mah error'

    await boss.send(queue, null, { onComplete: true })

    return new Promise((resolve) => {
      boss.work(queue, async job => {
        const error = new Error(errorMessage)

        await job.done(error)

        const failedJob = await boss.fetchCompleted(queue)

        assert.strictEqual(failedJob.data.state, 'failed')
        assert.strictEqual(failedJob.data.response.message, errorMessage)

        resolve()
      })
    })
  })

  it('failure via Promise reject() should pass string wrapped in value prop', async function () {
    const boss = this.test.boss = await helper.start(this.test.bossConfig)
    const queue = this.test.bossConfig.schema
    const failPayload = 'mah error'

    await boss.work(queue, job => Promise.reject(failPayload))
    await boss.send(queue, null, { onComplete: true })

    await delay(7000)

    const job = await boss.fetchCompleted(queue)

    assert.strictEqual(job.data.state, 'failed')
    assert.strictEqual(job.data.response.value, failPayload)
  })

  it('failure via Promise reject() should pass object payload', async function () {
    const boss = this.test.boss = await helper.start(this.test.bossConfig)
    const queue = this.test.bossConfig.schema
    const something = 'clever'

    const errorResponse = new Error('custom error')
    errorResponse.something = something

    await boss.work(queue, job => Promise.reject(errorResponse))
    await boss.send(queue, null, { onComplete: true })

    await delay(7000)

    const job = await boss.fetchCompleted(queue)

    assert.strictEqual(job.data.state, 'failed')
    assert.strictEqual(job.data.response.something, something)
  })

  it('failure with Error object should get stored in the failure job', async function () {
    const boss = this.test.boss = await helper.start(this.test.bossConfig)
    const queue = this.test.bossConfig.schema
    const message = 'a real error!'

    await boss.send(queue, null, { onComplete: true })
    await boss.work(queue, async () => { throw new Error(message) })

    await delay(2000)

    const job = await boss.fetchCompleted(queue)

    assert.strictEqual(job.data.state, 'failed')
    assert(job.data.response.message.includes(message))
  })

  it('should fail a job with custom connection', async function () {
    const boss = this.test.boss = await helper.start(this.test.bossConfig)
    const queue = this.test.bossConfig.schema

    await boss.send(queue)

    const job = await boss.fetch(queue)

    let called = false
    const _db = await helper.getDb()
    const db = {
      async executeSql (sql, values) {
        called = true
        return _db.pool.query(sql, values)
      }
    }

    await boss.fail(job.id, null, { db })

    assert.strictEqual(called, true)
  })

  it('failure via done() should pass error with circular payload to failed job', async function () {
    const axios = require('axios')
    const https = require('https')
    const boss = this.test.boss = await helper.start(this.test.bossConfig)
    const queue = this.test.bossConfig.schema

    await boss.send(queue, null, { onComplete: true })

    return new Promise((resolve) => {
      boss.work(queue, async job => {
        try {
          await axios.request({
            url: 'https://dev.example.com/abc',
            method: 'POST',
            timeout: 500,
            httpsAgent: new https.Agent({
              minVersion: 'TLSv1.2'
            })
          })
          assert.fail('request succeeded unexpectedly')
        } catch (error) {
          console.log('caught error, marking job as done')

          // test hangs here
          await job.done(error)

          console.log('fail complete')

          const failedJob = await boss.fetchCompleted(queue)
          assert.ok(failedJob !== null, 'failedJob is null')

          assert.strictEqual(failedJob.data.state, 'failed')
          assert.strictEqual(failedJob.data.response.message, error.message)

          resolve()
        }
      })
    })
  })
})
