import React from 'react'
import Modal from '../../modals/Modal'
import Button from '../../Button'
import { t, TRANSLATION } from '../../../localization'
import { EStatuses } from '../../../types/types'

interface IProps {
  isOpen: boolean
  text: string
  status?: EStatuses
  onConfirm: () => void
  onCancel: () => void
}

/** Подтверждение начала и окончания перерыва (ТЗ п. 8) */
const ConfirmModal: React.FC<IProps> = ({ isOpen, text, status, onConfirm, onCancel }) => (
  <Modal
    overlayProps={{ isOpen, onClick: onCancel }}
    className="breaks-confirm"
  >
    <p className="breaks-confirm_text">{text}</p>
    <div className="breaks-confirm_actions">
      <Button
        text={t(TRANSLATION.YES)}
        onClick={onConfirm}
        status={status}
      />
      <Button
        text={t(TRANSLATION.CANCEL)}
        onClick={onCancel}
      />
    </div>
  </Modal>
)

export default ConfirmModal
