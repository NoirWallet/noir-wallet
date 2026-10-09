import { useState } from 'react'
import { Button } from '../../components/ui/button'
import { PasswordInput } from '../../components/common/PasswordInput'
import { PageHeader } from '../../components/common/PageHeader'
import { accountManager } from '@/core/wallet/account-manager'
import { useNavigate } from '../../provider/Router'

export function ChangePassword() {
  const { goBack } = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [currentPasswordError, setCurrentPasswordError] = useState('')
  const [confirmPasswordError, setConfirmPasswordError] = useState('')

  const handleSubmit = async () => {
    setCurrentPasswordError('')
    setConfirmPasswordError('')

    if (!currentPassword) {
      setCurrentPasswordError('Current password is required')
      return
    }
    if (!newPassword) {
      setCurrentPasswordError('New password is required')
      return
    }
    if (newPassword !== confirmPassword) {
      setConfirmPasswordError('New password and confirm password do not match')
      return
    }

    setIsLoading(true)
    try {
      const success = await accountManager.changePassword(currentPassword, newPassword)

      if (success) {
        goBack()
      } else {
        setCurrentPasswordError('Failed to change password')
      }
    } catch (error: any) {
      setCurrentPasswordError(error.message || 'Failed to change password')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="page-container">
      <PageHeader title="Change Password" showBack />

      <div className="flex-1 flex flex-col px-5 pt-8">
        <div className="space-y-4">
          <PasswordInput
            value={currentPassword}
            onChange={setCurrentPassword}
            placeholder="Current Password"
            error={currentPasswordError}
          />
          <PasswordInput value={newPassword} onChange={setNewPassword} placeholder="New Password" />
          <PasswordInput
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder="Confirm New Password"
            error={confirmPasswordError}
          />
        </div>
      </div>

      <div className="px-5 pb-5">
        <Button
          onClick={handleSubmit}
          disabled={!currentPassword || !newPassword || !confirmPassword}
          isLoading={isLoading}
          className="w-full h-[45px]"
        >
          Change Password
        </Button>
      </div>
    </div>
  )
}
