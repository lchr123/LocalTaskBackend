import { Resend } from 'resend';
import { buildClient, CommitmentPolicy, KmsKeyringNode } from '@aws-crypto/client-node';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.FROM_EMAIL || 'no-reply@locallyhelper.com';
const KMS_KEY_ARN = process.env.KMS_KEY_ARN || 'arn:aws:kms:ap-northeast-1:765328019827:key/2c13f1d8-27f2-4c99-a076-4a2ae5665c8d';

const { decrypt } = buildClient(CommitmentPolicy.REQUIRE_ENCRYPT_ALLOW_DECRYPT);
const keyring = new KmsKeyringNode({ keyIds: [KMS_KEY_ARN] });

export const handler = async (event) => {
  console.log('triggerSource:', event.triggerSource);

  const encryptedCode = event.request.code;
  const email = event.request.userAttributes.email;

  if (!email) {
    console.log('No email attribute, skipping');
    return event;
  }

  // Decrypt the verification code using AWS Encryption SDK
  let code;
  try {
    const { plaintext } = await decrypt(keyring, Buffer.from(encryptedCode, 'base64'));
    code = plaintext.toString('utf-8');
    console.log('Code decrypted successfully');
  } catch (err) {
    console.error('Failed to decrypt code:', err);
    throw err;
  }

  let subject = '';
  let html = '';

  switch (event.triggerSource) {
    case 'CustomEmailSender_SignUp':
      subject = 'LocallyHelper - 验证您的邮箱';
      html = `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2>欢迎注册 LocallyHelper！</h2>
          <p>您的验证码是：</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 16px; background: #f5f5f5; border-radius: 8px; margin: 16px 0;">
            ${code}
          </div>
          <p style="color: #666; font-size: 14px;">验证码有效期为 10 分钟。如果您没有注册，请忽略此邮件。</p>
        </div>
      `;
      break;

    case 'CustomEmailSender_ForgotPassword':
      subject = 'LocallyHelper - 重置密码验证码';
      html = `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2>重置密码</h2>
          <p>您的验证码是：</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 16px; background: #f5f5f5; border-radius: 8px; margin: 16px 0;">
            ${code}
          </div>
          <p style="color: #666; font-size: 14px;">验证码有效期为 10 分钟。如果您没有请求重置密码，请忽略此邮件。</p>
        </div>
      `;
      break;

    case 'CustomEmailSender_ResendCode':
      subject = 'LocallyHelper - 重新发送验证码';
      html = `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2>验证码</h2>
          <p>您的验证码是：</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 16px; background: #f5f5f5; border-radius: 8px; margin: 16px 0;">
            ${code}
          </div>
          <p style="color: #666; font-size: 14px;">验证码有效期为 10 分钟。</p>
        </div>
      `;
      break;

    default:
      console.log('Unhandled trigger source:', event.triggerSource);
      return event;
  }

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject,
      html,
    });
    console.log(`Email sent to ${email} for ${event.triggerSource}`);
  } catch (err) {
    console.error('Failed to send email via Resend:', err);
    throw err;
  }

  return event;
};
