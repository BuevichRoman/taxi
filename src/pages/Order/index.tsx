import React, { useEffect, useState } from 'react'
import { connect, ConnectedProps } from 'react-redux'
import { useParams, useNavigate } from 'react-router-dom'
import PageSection from '../../components/PageSection'
import Button from '../../components/Button'
import Input from '../../components/Input'
import { addHiddenOrder } from '../../tools/utils'
import * as API from '../../API'
import { t, TRANSLATION } from '../../localization'
import ClientInfo from '../../components/order/ClientInfo'
import OrderInfo from '../../components/order/orderInfo/index'
import LoadFrame from '../../components/LoadFrame'
import { IRootState } from '../../state'
import { useInterval } from '../../tools/hooks'
import { EBookingDriverState, EBookingStates, EColorTypes, EStatuses } from '../../types/types'
import images from '../../constants/images'
import { useForm } from 'react-hook-form'
import './styles.scss'
import ChatToggler from '../../components/Chat/Toggler'
import Breaks from '../../components/order/Breaks'
import BreakConfirmModal from '../../components/order/Breaks/ConfirmModal'
import { tBreak } from '../../components/order/Breaks/texts'
import { orderSelectors, orderActionCreators } from '../../state/order'
import { modalsActionCreators } from '../../state/modals'
import { userSelectors } from '../../state/user'
import { EMapModalTypes } from '../../state/modals/constants'
import { withLayout } from '../../HOCs/withLayout'

const mapStateToProps = (state: IRootState) => ({
  order: orderSelectors.order(state),
  client: orderSelectors.client(state),
  start: orderSelectors.start(state),
  destination: orderSelectors.destination(state),
  status: orderSelectors.status(state),
  message: orderSelectors.message(state),
  user: userSelectors.user(state),
})

const mapDispatchToProps = {
  getOrder: orderActionCreators.getOrder,
  setOrder: orderActionCreators.setOrder,
  setCancelDriverOrderModal: modalsActionCreators.setDriverCancelModal,
  setRatingModal: modalsActionCreators.setRatingModal,
  setAlarmModal: modalsActionCreators.setAlarmModal,
  setLoginModal: modalsActionCreators.setLoginModal,
  setMapModal: modalsActionCreators.setMapModal,
  setMessageModal: modalsActionCreators.setMessageModal,
}

const connector = connect(mapStateToProps, mapDispatchToProps)

interface IFormValues {
  votingNumber: number
  performers_price: number
}

/**
 * Коды отказа сервера в тексты. Нужны на случай, если запрос всё же уйдёт:
 * состояние могло измениться между опросом и нажатием
 */
const BREAK_ERROR_TEXTS: Record<string, string> = {
  break_already_active: TRANSLATION.BREAK_ALREADY_ACTIVE,
  break_not_active: TRANSLATION.BREAK_NOT_ACTIVE,
  order_not_started: TRANSLATION.BREAK_NOT_ACTIVE,
  order_finished: TRANSLATION.ORDER_ALREADY_FINISHED,
}

interface IProps extends ConnectedProps<typeof connector> {}

const Order: React.FC<IProps> = ({
  order,
  client,
  start,
  destination,
  status,
  message,
  user,
  getOrder,
  setOrder,
  setMapModal,
  setRatingModal,
  setCancelDriverOrderModal,
  setMessageModal,
  setAlarmModal,
}) => {
  const [isFromAddressShort, setIsFromAddressShort] = useState(true)
  const [isToAddressShort, setIsToAddressShort] = useState(true)
  /** Какое подтверждение перерыва открыто: начало, окончание или ничего */
  const [breakConfirm, setBreakConfirm] = useState<'start' | 'end' | null>(null)

  const id = useParams().id as string
  const navigate = useNavigate()

  const driver = order?.drivers?.find(item => item.c_state > EBookingDriverState.Canceled)

  const { register, formState: { errors }, handleSubmit: formHandleSubmit, getValues } = useForm<IFormValues>({
    criteriaMode: 'all',
    mode: 'onSubmit',
  })

  useEffect(() => {
    getOrder(id)
    return () => {
      setOrder(null)
    }
  }, [])

  useInterval(() => {
    getOrder(id)
  }, 3000)

  const handleSubmit = () => {
    const isCandidate = ['96', '95'].some(item => order?.b_comments?.includes(item))

    API.takeOrder(id, { ...getValues() }, isCandidate)
      .then(() => {
        getOrder(id)
        setMessageModal({
          isOpen: true,
          status: EStatuses.Success,
          message: isCandidate ? t(TRANSLATION.YOUR_OFFER_SENT) : t(TRANSLATION.YOUR_ORDER_DESCRIPTION),
        })
      })
      .catch(error => {
        console.error(error)
        setMessageModal({
          isOpen: true,
          message: error.toString() || t(TRANSLATION.ERROR),
          status: EStatuses.Fail,
        })
      })
  }

  const onHideOrder = () => {
    addHiddenOrder(id, user?.u_id)
    navigate('/driver-order')
  }

  const onArrivedClick = () =>
    API.setOrderState(id, EBookingDriverState.Arrived)
      .then(() => getOrder(id))
      .catch(error => {
        console.error(error)
        setMessageModal({ isOpen: true, message: t(TRANSLATION.ERROR), status: EStatuses.Fail })
      })

  const onStartedClick = () =>
    API.setOrderState(id, EBookingDriverState.Started)
      .then(() => {
        getOrder(id)
        navigate('/driver-order?tab=map')
      })

  const onCompleteOrderClick = () => {
    if (!driver?.c_started) {
      setMessageModal({ 
        isOpen: true, 
        status: EStatuses.Fail, 
        message: t(TRANSLATION.ERROR)
      })
      return
    }

    
    API.setOrderState(id, EBookingDriverState.Finished)
      .then(() => {
        getOrder(id)
        setMessageModal({
          isOpen: true,
          status: EStatuses.Success,
          message: t(TRANSLATION.TRIP, { })
        })
        setRatingModal({ isOpen: true })
      })
      .catch(error => {
        console.error(error)
        setMessageModal({ 
          isOpen: true, 
          status: EStatuses.Fail, 
          message: t(TRANSLATION.ERROR) 
        })
      })
  }

  /**
   * Проверка допустимости действия перед отправкой (ТЗ п. 14).
   *
   * Сервер этих проверок не делает — автор кода ответил, что бэкенд не
   * дорабатывается и дубли отлавливает клиент. Возвращает ключ текста
   * отказа либо null, если действие допустимо.
   */
  const breakActionError = (isStart: boolean): string | null => {
    const execution = order?.b_options?.b_execution
    const mode = execution?.mode ?? null

    if (execution?.actual.ended || (mode === null && execution?.actual.started))
      return TRANSLATION.ORDER_ALREADY_FINISHED
    if (isStart && mode === 'break') return TRANSLATION.BREAK_ALREADY_ACTIVE
    if (!isStart && mode !== 'break') return TRANSLATION.BREAK_NOT_ACTIVE
    return null
  }

  /**
   * Начало и окончание перерыва. Заказ остаётся выполняющимся, меняется
   * только внутренний режим (ТЗ п. 7)
   */
  const onBreakConfirmed = () => {
    // Подтверждение смонтировано всегда, видимостью управляет оверлей:
    // без этой проверки «Да» при закрытом окне отправляло завершение перерыва
    if (breakConfirm === null) return

    const isStart = breakConfirm === 'start'
    setBreakConfirm(null)

    const error = breakActionError(isStart)
    if (error) {
      setMessageModal({ isOpen: true, status: EStatuses.Fail, message: tBreak(error) })
      return
    }

    API.setBreakState(id, isStart)
      .then(() => getOrder(id))
      .catch((error: { code?: string, message?: string }) => {
        console.error(error)
        // Код отказа показываем текстом: раньше няня видела в лицо строку
        // вида break_not_active
        const known = error?.code ? BREAK_ERROR_TEXTS[error.code] : undefined

        setMessageModal({
          isOpen: true,
          status: EStatuses.Fail,
          message: known ? tBreak(known) : t(TRANSLATION.ERROR),
        })
      })
  }

  const onAlarmClick = () =>
    setAlarmModal({ isOpen: true })

  const onRateOrderClick = () =>
    setRatingModal({ isOpen: true })

  const onExit = () =>
    navigate('/driver-order')

  const getButtons = () => {
    if (!order) return (
      <Button
        text={t(TRANSLATION.EXIT_NOT_AVIABLE)}
        className="order_take-order-btn"
        onClick={onExit}
        label={message}
        status={status}
      />
    )

    if (driver?.c_state === EBookingDriverState.Finished && driver?.c_rating) return (
      <Button
        text={t(TRANSLATION.EXIT)}
        className="order_take-order-btn"
        onClick={onExit}
        label={message}
        status={status}
      />)
    if (order.b_state === EBookingStates.Canceled) return (
      <Button
        text={t(TRANSLATION.EXIT_USER_CANCELLED)}
        className="order_take-order-btn"
        onClick={onExit}
        label={message}
        status={status}
      />
    )
    if (!driver) return <>
      {order?.b_voting && (
        <Input
          inputProps={{
            ...register('votingNumber', { required: t(TRANSLATION.REQUIRED_FIELD), min: 0, max: 9, valueAsNumber: true }),
            type: 'number',
            min: 0,
            max: 9,
          }}
          error={errors?.votingNumber?.message}
          label={t(TRANSLATION.DRIVE_NUMBER)}
        />
      )}
      {['96', '95'].some(item => order?.b_comments?.includes(item)) && (
        <Input
          inputProps={{
            ...register('performers_price', { required: t(TRANSLATION.REQUIRED_FIELD), min: 0, valueAsNumber: true }),
            type: 'number',
            min: 0,
          }}
          error={errors?.performers_price?.message}
          label={t(TRANSLATION.PRICE_PERFORMER)}
          oneline
        />
      )}
      {order.drivers?.find(i => i.u_id === user?.u_id)?.c_state !== EBookingDriverState.Considering && (<>
        <Button
          text={t(['96', '95'].some(item => order?.b_comments?.includes(item)) ? TRANSLATION.MAKE_OFFER : TRANSLATION.TAKE_ORDER)}
          type="submit"
          className="order_take-order-btn"
          label={message}
          status={status}
        />
        <Button
          text={t(TRANSLATION.HIDE_ORDER)}
          className="order_hide-order-btn"
          onClick={onHideOrder}
        />
      </>)}
    </>
    if (driver?.c_state === EBookingDriverState.Performer) return (
      <Button
        text={t(TRANSLATION.ARRIVED)}
        className="order_take-order-btn"
        onClick={onArrivedClick}
        label={message}
        status={status}
      />
    )
    if (driver?.c_state === EBookingDriverState.Arrived) return <>
      <Button
        text={t(TRANSLATION.WENT)}
        className="order_take-order-btn"
        onClick={onStartedClick}
        label={message}
        status={status}
      />
      <Button
        text={t(TRANSLATION.CANCEL_ORDER)}
        className="order_hide-order-btn"
        onClick={() => setCancelDriverOrderModal(true)}
        label={message}
        status={status}
      />
    </>
    if (driver?.c_state === EBookingDriverState.Started) return <>
      {order.b_options?.b_execution?.mode === 'break' ?
        <Button
          text={tBreak(TRANSLATION.BREAK_END)}
          className="order_take-order-btn"
          onClick={() => setBreakConfirm('end')}
          label={message}
          status={status}
        /> :
        <Button
          text={tBreak(TRANSLATION.BREAK_START)}
          className="order_break-btn"
          onClick={() => setBreakConfirm('start')}
          label={message}
          status={status}
        />
      }
      <Button
        text={t(TRANSLATION.CLOSE_DRIVE)}
        className="order_take-order-btn"
        onClick={onCompleteOrderClick}
        label={message}
        status={status}
      />
      <Button
        text={`${t(TRANSLATION.ALARM)}`}
        className="order_alarm-btn"
        onClick={onAlarmClick}
        colorType={EColorTypes.Accent}
        label={message}
        status={status}
      />
    </>
    if (driver?.c_state === EBookingDriverState.Finished) return <>
      <Button
        text={t(TRANSLATION.RATE_DRIVE)}
        className="order_take-order-btn"
        onClick={onRateOrderClick}
        label={message}
        status={status}
      />
    </>
  }

  return status === EStatuses.Loading && !order ?
    <LoadFrame/> :
    <PageSection className="order">
      {!!order ?
        (
          <form onSubmit={formHandleSubmit(handleSubmit)}>
            <ClientInfo order={order} client={client} user={user}/>
            <Breaks order={order}/>
            <BreakConfirmModal
              isOpen={breakConfirm !== null}
              text={tBreak(breakConfirm === 'end' ?
                TRANSLATION.BREAK_END_CONFIRM :
                TRANSLATION.BREAK_START_CONFIRM)}
              status={status}
              onConfirm={onBreakConfirmed}
              onCancel={() => setBreakConfirm(null)}
            />
            <div className="order__from-to colored">
              <div className='estimate-time'>
                {t(TRANSLATION.ESTIMATE_TIME)}:&nbsp;
                {order.b_estimate_waiting || 0 / 60} {t(TRANSLATION.MINUTES)}
              </div>
              <h3>{order.b_options?.object ? `${t(TRANSLATION.PICK_UP_PACKAGE)}:` : t(TRANSLATION.ADDRESSES)}</h3>
              <div className='from'>
                <label>
                  {isFromAddressShort && start?.shortAddress ? start?.shortAddress : start?.address}
                </label>
                <div className="from__buttons">
                  {start?.shortAddress && (
                    <img
                      src={isFromAddressShort ? images.minusIcon : images.plusIcon}
                      onClick={(e) => setIsFromAddressShort(prev => !prev)}
                      alt='change address mode'
                    />
                  )}
                  <img
                    src={images.markerYellow}
                    alt="marker"
                    className='address-marker'
                    onClick={() => {
                      setMapModal({
                        isOpen: true,
                        type: EMapModalTypes.OrderDetails,
                        defaultCenter: start?.latitude &&
                        start?.longitude ?
                          [start.latitude, start.longitude] :
                          null,
                      })
                    }}
                  />
                </div>
              </div>
              <div className="order-fields">
                <label>
                  {
                    !!order.b_options?.from_tel &&(
                      <a
                        className="phone-link"
                        href={`tel:${order.b_options.from_tel}`}
                      >{order.b_options.from_tel}</a>
                    )
                  }
                </label>
              </div>
              <div className='from-delivery'>
                {
                  order.b_options?.from_porch &&
                      (
                        <div className='group'>
                          <span>{t(TRANSLATION.PORCH)} <b>{order.b_options.from_porch}</b></span>
                          <span>{t(TRANSLATION.FLOOR)} <b>{order.b_options.from_floor}</b></span>
                          <span>{t(TRANSLATION.ROOM)} <b>{order.b_options.from_room}</b></span>
                        </div>
                      )
                }
                {
                  order.b_options?.from_way && (
                    <span className='way'>
                      <b>{t(order.b_comments?.includes('96') ? TRANSLATION.COMMENT : TRANSLATION.WAY)}:</b>&nbsp;
                      {order.b_options.from_way || t(TRANSLATION.NOT_SPECIFIED, { toLower: true })}
                    </span>
                  )
                }
                {
                  !order.b_comments?.includes('96') && order.b_options?.from_day && (
                    <span
                      className='time'
                    >
                      <b>{t(TRANSLATION.TAKE)}:</b>&nbsp;
                      {order.b_options.from_day}, {t(TRANSLATION.TIME_FROM, { toLower: true })}&nbsp;
                      {order.b_options.from_time_from} {t(TRANSLATION.TIME_TILL, { toLower: true })}&nbsp;
                      {order.b_options.from_time_to || t(TRANSLATION.NO_MATTER, { toLower: true })}
                    </span>
                  )
                }
                {
                  order.b_options?.from_tel && (
                    <span className='way'><b>{t(TRANSLATION.PHONE_TO_CALL)}:</b> {order.b_options.from_tel}
                      <img
                        src={images.phone}
                        alt={t(TRANSLATION.PHONE)}
                      />
                    </span>
                  )
                }
                {/* <div className="order__separator"/> */}
              </div>
              {order.b_options?.object &&
                <h3>{`${t(TRANSLATION.DELIVER_PACKAGE)}:`}</h3>}
              {(destination?.address || destination?.latitude || destination?.longitude) && (
                <div className='to'>
                  <label>
                    {isToAddressShort && destination?.shortAddress ? destination?.shortAddress : destination?.address}
                  </label>
                  <div className="to__buttons">
                    {destination?.shortAddress && (
                      <img
                        src={isToAddressShort ? images.minusIcon : images.plusIcon}
                        onClick={() => setIsToAddressShort(prev => !prev)}
                        alt='change address mode'
                      />
                    )}
                    <img
                      src={images.markerGreen}
                      alt="marker"
                      className='address-marker'
                      onClick={
                        () => {
                          setMapModal({
                            isOpen: true,
                            type: EMapModalTypes.OrderDetails,
                            defaultCenter: destination?.latitude &&
                            destination?.longitude ?
                              [destination.latitude, destination.longitude] :
                              null,
                          })
                        }
                      }
                    />
                  </div>
                </div>
              )}
              <div className='to-delivery'>
                {
                  order.b_options?.to_porch &&
                    (
                      <div className='group'>
                        <span>{t(TRANSLATION.PORCH)} <b>{order.b_options.to_porch}</b></span>
                        <span>{t(TRANSLATION.FLOOR)} <b>{order.b_options.to_floor}</b></span>
                        <span>{t(TRANSLATION.ROOM)} <b>{order.b_options.to_room}</b></span>
                      </div>
                    )
                }
                {
                  order.b_options?.to_way && (
                    <span className='way'>
                      <b>{t(order.b_comments?.includes('96') ? TRANSLATION.COMMENT : TRANSLATION.WAY)}:</b>&nbsp;
                      {order.b_options.to_way || t(TRANSLATION.NOT_SPECIFIED, { toLower: true })}
                    </span>
                  )
                }
                {
                  !order.b_comments?.includes('96') && order.b_options?.to_day && (
                    <span
                      className='time'
                    >
                      <b>{t(TRANSLATION.TAKE)}:</b>&nbsp;
                      {order.b_options.to_day}, {t(TRANSLATION.TIME_FROM, { toLower: true })}&nbsp;
                      {order.b_options.to_time_from} {t(TRANSLATION.TIME_TILL, { toLower: true })}&nbsp;
                      {order.b_options.to_time_to || t(TRANSLATION.NO_MATTER, { toLower: true })}
                    </span>
                  )
                }
                {
                  order.b_options?.to_tel && (
                    <span className='way'><b>{t(TRANSLATION.PHONE_TO_CALL)}:</b> {order.b_options.to_tel}
                      <img
                        src={images.phone}
                        alt={t(TRANSLATION.PHONE)}
                      />
                    </span>
                  )
                }
              </div>
            </div>
            <div className="order__separator"/>

            <OrderInfo order={order}/>
            {getButtons()}
            {
              driver && driver.u_id === user?.u_id && (
                <ChatToggler
                  anotherUserID={order.u_id}
                  orderID={order.b_id}
                />
              )
            }
          </form>
        ) :
        t(TRANSLATION.NOT_AVIABLE_ORDER)
      }
    </PageSection>
}

export default withLayout(connector(Order))
