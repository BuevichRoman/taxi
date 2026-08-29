import React, { useEffect, useMemo, useState } from 'react'
import { connect, ConnectedProps } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import cn from 'classnames'
import {
  EBookingDriverState,
  EBookingStates,
  EColorTypes,
  EPaymentWays,
  EStatuses,
  EOrderProfitRank,
  IAddressDetails,
  IOrder,
} from '../../types/types'
import images from '../../constants/images'
import SITE_CONSTANTS, { CURRENCY } from '../../siteConstants'
import {
  addHiddenOrder,
  dateFormatDate,
  dateShowFormat,
  formatCommentWithEmoji,
  getOrderCount,
  getPayment,
  formatCurrency,
} from '../../tools/utils'
import {
  calculateFinalPrice,
  calculateFinalPriceFormula,
  candidateMode,
  getExecution,
} from '../../tools/order'
import {
  applyBreakAction,
  breakActionError,
  finishExecution,
} from '../../tools/execution'
import { serverNow } from '../../tools/serverClock'
import * as API from '../../API'
import { useCachedState, useSelector } from '../../tools/hooks'
import { t, TRANSLATION } from '../../localization'
import { IRootState } from '../../state'
import { modalsActionCreators, modalsSelectors } from '../../state/modals'
import { EMapModalTypes } from '../../state/modals/constants'
import { ordersSelectors, ordersActionCreators } from '../../state/orders'
import { orderActionCreators } from '../../state/order'
import {
  ordersDetailsSelectors,
  ordersDetailsActionCreators,
} from '../../state/ordersDetails'
import { userSelectors } from '../../state/user'
import { EDriverTabs } from '../../pages/Driver'
import Icon from '../Icon'
import Button from '../Button'
import Input from '../Input'
import BreakConfirmModal from '../order/Breaks/ConfirmModal'
import { tBreak } from '../order/Breaks/texts'
import { Loader } from '../loader/Loader'
import '../Card/styles.scss'

const bookingStates: Record<number, keyof typeof EBookingStates> = {
  1: 'Processing',
  2: 'Approved',
  3: 'Canceled',
  4: 'Completed',
  5: 'PendingActivation',
  6: 'OfferedToDrivers',
}

const mapStateToProps = (state: IRootState) => ({
  user: userSelectors.user(state),
  modal: modalsSelectors.orderCardModal(state),
  activeChat: modalsSelectors.activeChat(state),
})

const mapDispatchToProps = {
  watchOrder: ordersActionCreators.watchOrder,
  takeOrder: ordersActionCreators.take,
  setOrderState: ordersActionCreators.setState,
  cancelOrder: ordersActionCreators.cancel,
  getOrderStart: ordersDetailsActionCreators.getOrderStart,
  getOrderDestination: ordersDetailsActionCreators.getOrderDestination,
  setSelectedOrderId: orderActionCreators.setSelectedOrderId,
  setModal: modalsActionCreators.setOrderCardModal,
  setCancelDriverOrderModal: modalsActionCreators.setDriverCancelModal,
  setRatingModal: modalsActionCreators.setRatingModal,
  setAlarmModal: modalsActionCreators.setAlarmModal,
  setLoginModal: modalsActionCreators.setLoginModal,
  setMapModal: modalsActionCreators.setMapModal,
  setMessageModal: modalsActionCreators.setMessageModal,
  setActiveChat: modalsActionCreators.setActiveChat,
}

const connector = connect(mapStateToProps, mapDispatchToProps)

interface IFormValues {
  votingNumber: number
  performers_price: number
}

interface IProps extends ConnectedProps<typeof connector> {}

function CardModal({ modal, ...props }: IProps) {
  return modal.orderId &&
    <CardModalContent {...modal} {...props} />
}

interface IContentProps extends Omit<ConnectedProps<typeof connector>,
  'modal'
> {
  isOpen: boolean
  orderId: IOrder['b_id']
}

function CardModalContent({
  isOpen: active,
  orderId,
  setModal,
  user,
  activeChat,
  watchOrder,
  takeOrder,
  setOrderState,
  cancelOrder,
  getOrderStart,
  getOrderDestination,
  setSelectedOrderId,
  setMapModal,
  setRatingModal,
  setCancelDriverOrderModal,
  setMessageModal,
  setAlarmModal,
  setActiveChat,
}: IContentProps) {

  const avatar = images.avatar
  const avatarSize = '48px'
  const closeModal = () => setModal({ isOpen: false, orderId })

  useEffect(() => active ? watchOrder(orderId) : undefined, [orderId, active])
  const order = useSelector(ordersSelectors.order, orderId) ?? null
  const orderMutates = useSelector(ordersSelectors.orderMutates, orderId)
  const inCandidateMode = useMemo(() =>
    candidateMode(order ?? undefined)
  , [order])

  useEffect(() => {
    if (order) {
      getOrderStart(order)
      getOrderDestination(order)
    }
  }, [order])
  let address = useSelector(ordersDetailsSelectors.start, orderId)
  if (address && 'details' in address)
    address = {
      ...address,
      shortAddress: formatShortAddress(address.details),
    }
  let destinationAddress =
    useSelector(ordersDetailsSelectors.destination, orderId)
  if (destinationAddress)
    destinationAddress = {
      ...destinationAddress,
      address: destinationAddress.address ??
        `${destinationAddress.latitude}, ${destinationAddress.longitude}`,
      shortAddress: 'details' in destinationAddress ?
        formatShortAddress(destinationAddress.details) :
        destinationAddress.shortAddress ?? (destinationAddress.address ?
          undefined :
          `${destinationAddress.latitude}, ${destinationAddress.longitude}`
        ),
    }

  const driver = useMemo(() =>
    order?.drivers?.find(item => item.c_state > EBookingDriverState.Canceled)
  , [order?.drivers])
  const userAsDriver = useMemo(() =>
    user && order?.drivers?.find(i => i.u_id === user.u_id)
  , [order?.drivers])

  const [isFromAddressShort, setIsFromAddressShort] = useCachedState(
    'components.modals.CardModal.isFromAddressShort',
    false,
  )

  const [breakConfirm, setBreakConfirm] = useState<'start' | 'end' | null>(null)

  const navigate = useNavigate()

  const { register, formState: { errors }, handleSubmit: formHandleSubmit, getValues } = useForm<IFormValues>({
    criteriaMode: 'all',
    mode: 'onSubmit',
  })

  useEffect(() => {
    if (active && orderId)
      setSelectedOrderId(orderId)
  }, [active, orderId])

  const handleSubmit = () => orderMutation(async() => {
    await takeOrder(orderId, { ...getValues() })
  })

  const onArrivedClick = () => orderMutation(async() => {
    await setOrderState(orderId, EBookingDriverState.Arrived)
  })

  const onHideOrder = () => {
    addHiddenOrder(orderId, user?.u_id)
  }

  const onStartedClick = () => orderMutation(async() => {
    await setOrderState(orderId, EBookingDriverState.Started)
    navigate('/driver-order?tab=map')
    closeModal()
  })

  const onCompleteOrderClick = () => orderMutation(async() => {
    // Завершать во время перерыва можно (ТЗ п. 12): сначала закрываем
    // открытый перерыв, потом завершаем заказ. Порядок важен — после
    // завершения edit заказа исполнителю уже недоступен
    if (userAsDriver) {
      const finished = finishExecution(
        userAsDriver.c_options?.c_execution,
        userAsDriver.c_started ? String(userAsDriver.c_started) : null,
        serverNow(),
      )
      await API.saveExecution(orderId, finished)
    }

    await setOrderState(orderId, EBookingDriverState.Finished)
    navigate(`/driver-order?tab=${EDriverTabs.Lite}`)
    setRatingModal({ isOpen: true, orderID: orderId })
    closeModal()
  })

  /** Проверка допустимости действия перед отправкой (ТЗ п. 14) */
  const checkBreakAction = (isStart: boolean): string | null =>
    breakActionError(getExecution(order, user?.u_id), isStart)

  /**
   * Начало и окончание перерыва из карточки заказа. Заказ остаётся
   * выполняющимся, меняется только внутренний режим (ТЗ п. 7)
   */
  const onBreakConfirmed = () => {
    // Подтверждение смонтировано всегда, видимостью управляет оверлей:
    // без этой проверки «Да» при закрытом окне отправляло бы действие
    if (breakConfirm === null) return

    const isStart = breakConfirm === 'start'
    setBreakConfirm(null)

    const error = checkBreakAction(isStart)
    if (error) {
      setMessageModal({ isOpen: true, status: EStatuses.Fail, message: tBreak(error) })
      return
    }

    orderMutation(async() => {
      const next = applyBreakAction(
        userAsDriver?.c_options?.c_execution,
        isStart,
        userAsDriver?.c_started ? String(userAsDriver.c_started) : null,
        serverNow(),
      )
      await API.saveExecution(orderId, next)
      watchOrder(orderId)
    })
  }

  const cancelAndClose = () => orderMutation(async() => {
    await cancelOrder(orderId)
    closeModal()
  })

  async function orderMutation(mutation: () => Promise<void>) {
    try {
      await mutation()
    } catch (error) {
      console.error(error)
      setMessageModal({
        isOpen: true,
        message: (error as any).toString() || t(TRANSLATION.ERROR),
        status: EStatuses.Fail,
      })
    }
  }

  const onAlarmClick = () => {
    setAlarmModal({ isOpen: true })
  }

  const onRateOrderClick = () => {
    setRatingModal({ isOpen: true, orderID: orderId })
  }

  const openChatModal = () => {
    // Если клиент на сайте, используем стандартный чат
    if (!order?.b_options?.createdBy) {
      const from = `${user?.u_id}_${orderId}`
      const to = `${order?.u_id}_${orderId}`
      const chatID = `${from};${to}`
      setActiveChat(activeChat === chatID ? null : chatID)
      return
    }

    // Ищем профиль клиента
    if (!order.user) return

    // В зависимости от типа контакта формируем соответствующую ссылку
    switch (order.b_options.createdBy) {
      case 'sms':
        // Ссылка на приложение для звонков
        window.location.href = `tel:${order.user?.u_phone}`
        break
      case 'whatsapp':
        window.location.href = `https://wa.me/${order.user?.u_phone}`
        break
      default:
        // Для неизвестных типов используем стандартный чат
        const from = `${user?.u_id}_${orderId}`
        const to = `${order?.u_id}_${orderId}`
        const chatID = `${from};${to}`
        setActiveChat(activeChat === chatID ? null : chatID)
    }
  }

  const getButtons = () => {
    const buttonProps = {
      className: 'order_take-order-btn',
    }
    const actionButtonProps = {
      ...buttonProps,
      disabled: orderMutates,
    }
    const submitButtonProps = {
      ...actionButtonProps,
      type: 'submit' as const,
    }

    if (!order)
      return (
        <Button
          {...buttonProps}
          text={t(TRANSLATION.EXIT_NOT_AVIABLE)}
          onClick={closeModal}
        />
      )

    if (order.b_state === EBookingStates.Canceled)
      return (
        <Button
          {...buttonProps}
          text={t(TRANSLATION.EXIT_USER_CANCELLED)}
          onClick={closeModal}
        />
      )
    if (userAsDriver?.c_state === EBookingDriverState.Performer)
      return <>
        <Button
          {...actionButtonProps}
          svg={<Icon src="whatsapp" width="20" height="20" fill="white" />}
          onClick={openChatModal}
          wrapperProps={{ style: { maxWidth: '20%' } }}
        />
        <Button
          {...actionButtonProps}
          text={t(TRANSLATION.ARRIVED)}
          onClick={onArrivedClick}
        />
        <Button
          {...actionButtonProps}
          svg={<Icon src="chat" width="20" height="20" fill="white" />}
          onClick={() => setCancelDriverOrderModal(true)}
          wrapperProps={{ style: { maxWidth: '20%' } }}
        />
      </>
    if (userAsDriver?.c_state === EBookingDriverState.Arrived)
      return <>
        <Button
          {...actionButtonProps}
          svg={<Icon src="whatsapp" width="20" height="20" fill="white" />}
          onClick={openChatModal}
          wrapperProps={{ style: { maxWidth: '20%' } }}
        />
        <Button
          {...actionButtonProps}
          text={t(TRANSLATION.WENT)}
          onClick={onStartedClick}
        />
        <Button
          {...actionButtonProps}
          svg={<Icon src="chat" width="20" height="20" fill="white" />}
          onClick={() => setCancelDriverOrderModal(true)}
          wrapperProps={{ style: { maxWidth: '20%' } }}
        />
      </>
    if (userAsDriver?.c_state === EBookingDriverState.Started)
      return <>
        {userAsDriver?.c_options?.c_execution?.mode === 'break' ?
          <Button
            {...actionButtonProps}
            text={tBreak(TRANSLATION.BREAK_END)}
            onClick={() => setBreakConfirm('end')}
          /> :
          <Button
            {...actionButtonProps}
            className="order_break-btn"
            text={tBreak(TRANSLATION.BREAK_START)}
            onClick={() => setBreakConfirm('start')}
          />
        }
        <Button
          {...actionButtonProps}
          text={t(TRANSLATION.CLOSE_DRIVE)}
          onClick={onCompleteOrderClick}
        />
        <Button
          {...actionButtonProps}
          className="order_alarm-btn"
          text={`${t(TRANSLATION.ALARM)}`}
          onClick={onAlarmClick}
          colorType={EColorTypes.Accent}
        />
      </>
    if (userAsDriver?.c_state === EBookingDriverState.Finished)
      return <>
        <Button
          {...actionButtonProps}
          text={t(TRANSLATION.RATE_DRIVE)}
          onClick={onRateOrderClick}
        />
      </>

    if (userAsDriver?.c_state === EBookingDriverState.Considering)
      return (
        <Button
          {...actionButtonProps}
          text={t(TRANSLATION.CANCEL_AND_CLOSE)}
          onClick={cancelAndClose}
        />
      )

    if (!driver)
      return <>
        {order?.b_voting && (
          <Input
            inputProps={{
              ...register('votingNumber', {
                required: t(TRANSLATION.REQUIRED_FIELD),
                min: 0,
                max: 9,
                valueAsNumber: true,
              }),
              type: 'number',
              min: 0,
              max: 9,
            }}
            error={errors?.votingNumber?.message}
            label={t(TRANSLATION.DRIVE_NUMBER)}
          />
        )}
        {SITE_CONSTANTS.C_OPTIONS_VALID_KEYS.performers_price &&
          inCandidateMode &&
          <Input
            inputProps={{
              ...register('performers_price', {
                required: t(TRANSLATION.REQUIRED_FIELD),
                min: 0,
                valueAsNumber: true,
              }),
              type: 'number',
              min: 0,
            }}
            error={errors?.performers_price?.message}
            label={t(TRANSLATION.PRICE_PERFORMER)}
            oneline
          />
        }
        <Button
          {...submitButtonProps}
          text={t(inCandidateMode ?
            TRANSLATION.MAKE_OFFER :
            TRANSLATION.TAKE_ORDER,
          )}
        />
        <Button
          {...actionButtonProps}
          text={t(TRANSLATION.HIDE_ORDER)}
          onClick={onHideOrder}
        />
      </>

    return (
      <Button
        {...buttonProps}
        text={t(TRANSLATION.EXIT)}
        onClick={closeModal}
      />
    )
  }

  const outsideClick = ( e: React.MouseEvent<HTMLDivElement, MouseEvent> ) => {
    if ( e.currentTarget === e.target ) {
      closeModal()
    }
  }

  const shortAddressHandler = () => {
    setIsFromAddressShort(prev => !prev)
  }

  const getStatusText = () => {
    if (order?.b_voting) return t(TRANSLATION.VOTER)
    return ''
  }

  const getStatusTextColor = () => {
    if (order?.b_voting) return '#FF2400'
    // 'reccomended': return '#00A72F'\
    return 'rgba(0, 0, 0, 0.25)'
  }
  const price = calculateFinalPrice(order)

  const _type = order?.b_payment_way === EPaymentWays.Credit ?
    TRANSLATION.CARD :
    TRANSLATION.CASH
  const _value = order?.b_options?.customer_price ?
    (
      t(_type) + '. ' +
      t(TRANSLATION.CUSTOMER_PRICE) +
      ` ${order.b_options.customer_price} ${CURRENCY.SIGN}`
    ) :
    (
      t(_type) + '. ' +
      t(TRANSLATION.FIXED) +
      `${price ? CURRENCY.SIGN : ''}` +
      `${(price || '-') || getPayment(order).text}`
    )

  return (
    <div
      className={cn(
        'status-card__modal',
        order?.profitRank !== undefined && `status-card__modal--profit--${{
          [EOrderProfitRank.Low]: 'low',
          [EOrderProfitRank.Medium]: 'medium',
          [EOrderProfitRank.High]: 'high',
        }[order.profitRank]}`,
      )}
      data-active={active}
      onClick={outsideClick}
    >
      <div>

        <div className='top' >
          <div
            className="avatar"
            style={{
              backgroundSize: avatarSize,
              backgroundImage: `url(${avatar})`,
            }}
          />
          <div className="name" >
            <p>
              {order?.user?.u_family?.trimStart()}
              {order?.user?.u_name?.trimStart()}
              {order?.user?.u_middle?.trimStart()}
              <span>
                ({order?.u_id}) ({bookingStates[order?.b_state as any]})
              </span>
            </p>
          </div>
          <div className='stars' >
            {[1,2,3,4].map(num =>
              <Icon
                key={num}
                src="filledStar"
                width="10"
                height="10"
                fill="#FF2400"
              />,
            )}
            {[1].map(num =>
              <Icon
                key={num}
                src="star"
                width="10"
                height="10"
                stroke="#FF2400"
              />,
            )}
            <span>24/20</span>
          </div>
          <b style={{ color: getStatusTextColor() }}>№{order?.b_id} {getStatusText()}</b>
        </div>

        <div className='address' >
          <b>Estimate time: {(Math.trunc(order?.b_options?.pricingModel?.options?.duration) || 0)} min</b>
          <p>
            Departure and Arrival Address
            <span className="from_address">
              {t(TRANSLATION.FROM)}:
              {address?.shortAddress ?
                <>
                  <span>{isFromAddressShort ? address.shortAddress : address.address}</span>
                  <img
                    src={isFromAddressShort ? images.plusIcon : images.minusIcon}
                    onClick={shortAddressHandler}
                    alt='change address mode'
                  />
                </> :
                order?.b_destination_address ? <span>{order?.b_start_address}</span> : <Loader />
              }
              <span
                onClick={() => {
                  setMapModal({
                    isOpen: true,
                    type: EMapModalTypes.OrderDetails,
                    defaultCenter: address?.latitude &&
                    address?.longitude ?
                      [address.latitude, address.longitude] :
                      null,
                  })
                }}
                className="svg"
              >
                <Icon
                  src="locationPoint"
                  width="18"
                  height="19"
                  fill="#FF9900"
                />
              </span>
              {t(TRANSLATION.TO)}:
              {destinationAddress?.shortAddress ?
                <span>{isFromAddressShort ? destinationAddress.shortAddress : destinationAddress.address}</span> :
                order?.b_destination_address ? <span>{order?.b_destination_address}</span> : <Loader />
              }
              <span
                onClick={() => {
                  setMapModal({
                    isOpen: true,
                    type: EMapModalTypes.OrderDetails,
                    defaultCenter: destinationAddress?.latitude &&
                    destinationAddress?.longitude ?
                      [destinationAddress.latitude, destinationAddress.longitude] :
                      null,
                  })
                }}
                className="svg"
              >
                <Icon
                  src="locationPoint"
                  width="18"
                  height="19"
                  fill="#00B100"
                />
              </span>
            </span>
          </p>
        </div>

        <div className="time" >
          <Icon src="clock" width="18" height="19" stroke="#FF2400" />
          <p>{t(TRANSLATION.START_TIME)}: <span>{order?.b_start_datetime?.format(
            order.b_options?.time_is_not_important ? dateFormatDate : dateShowFormat,
          )}</span></p>
        </div>

        <div className="payment" >
          <Icon src="moneyCircle" width="18" height="19" stroke="#FF2400" />
          <div>
            <p>{t(TRANSLATION.PAYMENT_WAY)}: {_value}{order?.b_options?.pricingModel?.calculationType === 'incomplete' ? ' + ?' : ''}</p>
            <p>{t(TRANSLATION.CALCULATION) + ': ' + calculateFinalPriceFormula(order)}</p>
            {order?.profit &&
              <p className='status-card__profit'>
                {formatCurrency(order.profit, { signDisplay: 'always' })}
              </p>
            }
          </div>
        </div>

        <div className="client" >
          <div className="comments" data-active={false} onClick={e => e.currentTarget.dataset.active=e.currentTarget.dataset.active==='false'?'true':'false'} >
            {order?.u_id &&
              formatCommentWithEmoji(order.b_comments)?.map(({
                id, src, hint,
              }) =>
                <p><img key={id} src={src} alt="" /><span>{hint}</span></p>,
              )
            }
          </div>

          {order &&
            <span className='status-card__seats'>
              <Icon src="people" width="16" height="16" stroke="#FF2400" />
              <label>{getOrderCount(order)}</label>
            </span>
          }

          <form onSubmit={formHandleSubmit(handleSubmit)} >
            <div className="btns" >
              {getButtons()}
            </div>
          </form>

          <BreakConfirmModal
            isOpen={breakConfirm !== null}
            text={tBreak(breakConfirm === 'end' ?
              TRANSLATION.BREAK_END_CONFIRM :
              TRANSLATION.BREAK_START_CONFIRM)}
            onConfirm={onBreakConfirmed}
            onCancel={() => setBreakConfirm(null)}
          />
        </div>

      </div>
    </div>
  )
}

export default connector(CardModal)

function formatShortAddress(address: IAddressDetails) {
  const { road, suburb, city, county, state, country } = address
  const parts = [road, suburb, city, county, state, country].filter(Boolean)
  return parts.join(', ')
}