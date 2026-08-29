import axios from 'axios'
import { Stringify } from '../types'
import {
  EServices,
  EBookingDriverState,
  EOrderTypes,
  EPaymentWays,
  IBookingAddresses,
  IBookingCoordinates,
  ICarExecution,
  IOrder,
  IUser,
} from '../types/types'
import { IResponse } from '../types/api'
import { cloneFormData } from '../tools/utils'
import { convertOrder, reverseConvertOrder } from '../tools/convert'
import {
  addToFormData, apiMethod, IApiMethodArguments, IResponseFields,
} from '../tools/api'
import Config from '../config'
import { t, TRANSLATION } from '../localization'
import store from '../state'
import { userSelectors } from '../state/user'
import { EBookingActions } from './constants'
import { getUserCar } from './car'

async function _postDrive(
  { formData }: IApiMethodArguments,
  data: IOrder,
): Promise<IResponseFields & {
  b_id: IOrder['b_id'],
  b_driver_code: IOrder['b_driver_code']
}> {
  const defaults: Partial<IOrder> = {
    b_payment_way: EPaymentWays.Cash,
  }

  const converted = reverseConvertOrder({
    ...defaults,
    ...data,
    b_services: data.b_voting && !data.b_services?.includes(EServices.Voting) ?
      [...(data.b_services ?? []), EServices.Voting] :
      data.b_services,
  })

  const params = cloneFormData(formData)
  addToFormData(params, {
    data: JSON.stringify(Object.fromEntries(
      [
        'b_start_address',
        'b_start_latitude',
        'b_start_longitude',
        'b_destination_address',
        'b_destination_latitude',
        'b_destination_longitude',
        'b_start_datetime',
        'b_custom_comment',
        'b_flight_number',
        'b_terminal',
        'b_passengers_count',
        'b_luggage_count',
        'b_placard',
        'b_car_class',
        'b_payment_way',
        'b_payment_card',
        'b_cars_count',
        'b_max_waiting',
        'b_options',
        'b_contact',
        'b_comments',
        'b_services',
        'b_location_class',
        'b_currency',
      ].filter(key => key in converted).map(key => [key, converted[key]]),
    )),
  })

  const response = await axios.post(`${Config.API_URL}/drive`, params)
  if (response.data.status === 'error')
    throw response.data
  const result = response.data.data
  result.b_id = result.b_id.toString()

  if (data.b_voting) {
    const params = cloneFormData(formData)
    addToFormData(params, {
      action: EBookingActions.SetConfirmState,
    })
    await axios.post(`${Config.API_URL}/drive/get/${result.b_id}`, params)
  }

  return result
}
export const postDrive = apiMethod<typeof _postDrive>(_postDrive)

const _cancelDrive = (
  { formData }: IApiMethodArguments,
  id: IOrder['b_id'],
  reason?: IOrder['b_cancel_reason'],
) => {
  addToFormData(formData, {
    action: EBookingActions.SetCancelState,
    reason,
  })

  return axios.post(`${Config.API_URL}/drive/get/${id}`, formData)
    .then(res => res.data)
}
export const cancelDrive = apiMethod<typeof _cancelDrive>(_cancelDrive)

export const getOrders: <TType extends EOrderTypes>(
  type?: TType,
  filter?: TType extends EOrderTypes.Ready ? {
    carClasses?: boolean
    locationClasses?: boolean
  } : undefined
) => Promise<IResponse<'200', {
  booking: IOrder[]
}> | IResponse<'404', {
  detail?: 'used_car_not_found'
}>> = apiMethod(async(
  { formData }: IApiMethodArguments,
  type: EOrderTypes = EOrderTypes.Active,
  filter: {
    carClasses?: boolean
    locationClasses?: boolean
  } = {},
) => {
  const userID = userSelectors.user(store.getState())?.u_id

  addToFormData(formData, {
    array_type: 'list',
  })

  const hiddenOrders = JSON.parse(localStorage.getItem('hiddenOrders') || '{}')
  const userHiddenOrders = hiddenOrders && userID && hiddenOrders[userID]

  const queryParams: string[] = []
  let URLAdditionalPath = ''
  switch (type) {
    case EOrderTypes.Active:
      queryParams.push('fields=00000000u1')
      break
    case EOrderTypes.Ready:
      URLAdditionalPath = '/now'
      break
    case EOrderTypes.History:
      URLAdditionalPath = '/archive'
      break
    default:
      return Promise.reject()
  }
  if (filter.carClasses)
    queryParams.push('filter=b_car_classes')
  if (filter.locationClasses)
    queryParams.push('filter=b_location_classes')

  const { data: response } = await axios.post(
    `${Config.API_URL}/drive${URLAdditionalPath}` +
    (queryParams.length > 0 ? `?${queryParams.join('&')}` : ''),
    formData,
  )
  if (response.code === '404' && [
    'used car not found',
    'empty driver location classes',
  ].includes(response.message))
    return { ...response, data: { detail: 'used_car_not_found' } }
  if (response.code !== '200')
    return response

  if (type === EOrderTypes.Active)
    for (const item of response.data.booking)
      item.user = response.data.user[item.u_id]

  return {
    ...response,
    data: {
      ...response.data,
      booking: response.data.booking
        ?.filter((item: IOrder) =>
          !(userHiddenOrders && userHiddenOrders.includes(item.b_id)),
        )
        .map((item: any) => convertOrder(item))
        .filter((item: IOrder) => item.b_confirm_state)
        .sort((a: IOrder, b: IOrder) =>
          a.b_start_datetime < b.b_start_datetime ? 1 : -1,
        ),
    },
  }
})

const _getOrder = (
  { formData }: IApiMethodArguments,
  id: IOrder['b_id'],
): Promise<IOrder | null> => {
  return axios.post(`${Config.API_URL}/drive/get/${id}?fields=00000000u1`, formData)
    .then(res => res.data.data)
    .then(res => {
      const raw = res.booking && res.booking[id]
      if (!raw) return null

      const order = convertOrder(raw)
      // Отметка серверного времени нужна для таймеров перерывов (ТЗ п. 4).
      // Боевой API её не отдаёт, поэтому поле необязательное: без него
      // таймеры идут от часов устройства в фиксированном поясе
      order.server_time = res.server_time ?? raw.server_time
      return order
    })
}
export const getOrder = apiMethod<typeof _getOrder>(_getOrder)

const _editOrder = (
  { formData }: IApiMethodArguments,
  id: IOrder['b_id'],
  data: IBookingAddresses & Stringify<IBookingCoordinates>,
): Promise<IResponseFields> => {
  addToFormData(formData, {
    action: EBookingActions.Edit,
    data: JSON.stringify(data),
  })

  return axios.post(`${Config.API_URL}/drive/get/${id}`, formData)
    .then(res => res.data)
}
export const editOrder = apiMethod<typeof _editOrder>(_editOrder)

const _takeOrder = (
  { formData }: IApiMethodArguments,
  id: IOrder['b_id'],
  options: {
    votingNumber: number
    performers_price: number
  },
  candidate?: boolean,
): Promise<{
  /** Индекс водителя */
  c_index: string,
  /** Текущее число машин поездки с booking_driver_states=3,4,5,6 */
  current_cars_count: string,
  /** Необходимое число машин поездки */
  b_cars_count: string,
  /** Если изменился статус поезки */
  b_state?: '1->2' | null
}> => {
  const userID = userSelectors.user(store.getState())?.u_id
  if (!userID) {
    Promise.reject(t(TRANSLATION.WRONG_USER_ROLE))
  }

  return getUserCar(userID as string)
    .then(car => {
      if (!car) return Promise.reject(t(TRANSLATION.NOT_LINKED_CAR))

      addToFormData(formData, {
        action: EBookingActions.SetPerformer,
        performer: candidate ? '0' : '1',
        b_driver_code: options.votingNumber,
        data: JSON.stringify({
          c_id: car.c_id,
          c_payment_way: EPaymentWays.Cash,
          c_options: { performers_price: options.performers_price },
        }),
      })

      return axios.post(`${Config.API_URL}/drive/get/${id}`, formData)
        .then(res => res.data)
        .then(res => res.status === 'error' ? Promise.reject(res.message) : res)
    })
}
export const takeOrder = apiMethod<typeof _takeOrder>(_takeOrder)

const _chooseCandidate = (
  { formData }: IApiMethodArguments,
  id: IOrder['b_id'],
  user?: IUser['u_id'],
): Promise<any> => {
  const userID = userSelectors.user(store.getState())?.u_id
  if (!userID) Promise.reject(t(TRANSLATION.WRONG_USER_ROLE))

  addToFormData(formData, {
    action: EBookingActions.SetPerformer,
    performer: '1',
    u_id: user,
  })

  return axios.post(`${Config.API_URL}/drive/get/${id}`, formData)
    .then(res => res.data)
    .then(res => res.status === 'error' ? Promise.reject() : res)
}
export const chooseCandidate = apiMethod<typeof _chooseCandidate>(_chooseCandidate)

const _setOrderState = (
  { formData }: IApiMethodArguments,
  id: IOrder['b_id'],
  state: EBookingDriverState,
) => {
  let action
  switch (state) {
    case EBookingDriverState.Arrived:
      action = EBookingActions.SetArriveState
      break
    case EBookingDriverState.Started:
      action = EBookingActions.SetStartState
      break
    case EBookingDriverState.Finished:
      action = EBookingActions.SetCompleteState
      break
    default:
      return Promise.reject()
  }

  addToFormData(formData, {
    action,
  })

  return axios.post(`${Config.API_URL}/drive/get/${id}`, formData)
    .then(res => res.data)
    .then(res => res.status === 'error' ? Promise.reject() : res)
}
export const setOrderState = apiMethod<typeof _setOrderState>(_setOrderState)

const _setOrderRating = (
  { formData }: IApiMethodArguments,
  id: IOrder['b_id'],
  value: number,
) => {
  addToFormData(formData, {
    action: EBookingActions.SetRate,
    value,
  })

  return axios.post(`${Config.API_URL}/drive/get/${id}`, formData)
    .then(res => res.data)
}
/**
 * @param value rating from 1 till 5
 */
export const setOrderRating = apiMethod<typeof _setOrderRating>(_setOrderRating)

const _setWaitingTime = (
  { formData }: IApiMethodArguments,
  id: IOrder['b_id'],
  previous: number,
  additional: number = 180,
) => {
  addToFormData(formData, {
    action: EBookingActions.SetWaitingTime,
    previous,
    additional,
  })

  return axios.post(`${Config.API_URL}/drive/get/${id}`, formData)
    .then(res => res.data)
}
/**
 * Adds time to wait
 * @param previous actual waiting time
 */
export const setWaitingTime = apiMethod<typeof _setWaitingTime>(_setWaitingTime)

const _saveExecution = (
  { formData }: IApiMethodArguments,
  id: IOrder['b_id'],
  execution: ICarExecution,
) => {
  addToFormData(formData, {
    action: EBookingActions.Edit,
    // Список правок, а не объект: edit накладывает их поверх сохранённого
    // и чужие ключи не затирает. Обычный объект отбивается как
    // `c_options element not array`
    data: JSON.stringify({ c_options: [['=', ['c_execution'], execution]] }),
  })

  return axios.post(`${Config.API_URL}/drive/get/${id}`, formData)
    .then(res => res.data)
    // Именно на признак успеха, а не на отсутствие ошибки: неизвестное
    // действие бэкенд не отвергает, а возвращает пустой ответ с кодом 200,
    // и проверка «не ошибка» такой ответ пропускала как успешный
    .then(res => res.status === 'success' ? res : Promise.reject(res))
}
/**
 * Saves the nanny's progress: current mode and actual breaks.
 *
 * Goes to `c_options` — the performer's own field on the order. `b_options`
 * is not writable by a performer: the `edit` method builds its allowed-field
 * list per role, and the performer only ever gets `c_options`.
 */
export const saveExecution = apiMethod<typeof _saveExecution>(_saveExecution)