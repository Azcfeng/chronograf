import uuid from 'uuid'

import QueryManager from 'src/perf/QueryManager'
import WebSocketConnection from 'src/perf/WebSocketConnection'

import {
  decodeRunLengthEncodedTimes,
  nanosecondsToMilliseconds,
} from 'src/perf/utils'

import {JSONResponse} from 'src/perf/types'

class QueriesManager {
  private ws: WebSocketConnection
  private requests: {[id: string]: QueryManager}

  private lastMetadata?: {
    requestID: string
    requestDone: boolean
    column: string
  }

  constructor(wsURL) {
    this.ws = new WebSocketConnection(wsURL, this.handleMessage, 'arraybuffer')
    this.requests = {}
  }

  public addQuery(query: string): QueryManager {
    return new QueryManager(query, this)
  }

  public send(queryManager: QueryManager) {
    const requestID = uuid.v4()

    this.requests[requestID] = queryManager

    this.ws.send(
      JSON.stringify({
        id: requestID,
        type: 'QUERY',
        data: {query: queryManager.query},
      })
    )
  }

  private handleMessage = (msg: MessageEvent) => {
    if (typeof msg.data === 'string') {
      this.handleJSONMessage(JSON.parse(msg.data))
    } else {
      this.handleDataMessage(msg.data)
    }
  }

  private handleJSONMessage = (msg: JSONResponse) => {
    if (msg.type === 'ERROR') {
      throw new Error(msg.data.message)
    }

    if (msg.data.column === 'time' && msg.data.isNormalized) {
      const {startTime, timeDelta, timeCount} = msg.data
      const queryManager = this.requests[msg.id]
      const times = decodeRunLengthEncodedTimes(startTime, timeDelta, timeCount)

      if (msg.done) {
        console.log(`${Date.now()}\treceived data\t${msg.id.slice(0, 6)}`)
      }

      queryManager.addColumnData('time', times, msg.done)

      return
    }

    this.lastMetadata = {
      requestID: msg.id,
      column: msg.data.column,
      requestDone: msg.done,
    }
  }

  private handleDataMessage = (buf: ArrayBuffer) => {
    const {column, requestID, requestDone} = this.lastMetadata

    if (requestDone) {
      console.log(`${Date.now()}\treceived data\t${requestID.slice(0, 6)}`)
    }

    const queryManager = this.requests[requestID]

    let data

    if (column === 'time') {
      data = new Float64Array(buf)
      nanosecondsToMilliseconds(data)
    } else {
      data = new Float32Array(buf)
    }

    queryManager.addColumnData(column, data, requestDone)
  }
}

export default QueriesManager