"""Email delivery via Resend."""
import resend

from app.config import settings


def _client() -> None:
    resend.api_key = settings.resend_api_key


def send_otp(to_email: str, name: str, code: str) -> None:
    """Send the 6-digit OTP to the user's email address."""
    _client()
    resend.Emails.send({
        "from": f"Carlisle Pay Review <{settings.resend_from_email}>",
        "to": [to_email],
        "subject": f"{code} — your Carlisle Pay Review sign-in code",
        "html": f"""
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0"
               style="background:white;border-radius:12px;border:1px solid #e2e8f0;padding:40px;">
          <tr>
            <td>
              <p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:0.08em;
                         text-transform:uppercase;color:#94a3b8;">Carlisle Health Group</p>
              <h1 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#0f172a;">
                Sign-in verification
              </h1>
              <p style="margin:0 0 8px;font-size:14px;color:#475569;">
                Hi {name}, use the code below to complete your sign-in.
                It expires in {settings.otp_expiry_minutes} minutes.
              </p>

              <div style="margin:28px 0;text-align:center;">
                <span style="display:inline-block;padding:16px 36px;
                             background:#0f172a;color:white;border-radius:10px;
                             font-size:32px;font-weight:800;letter-spacing:0.25em;
                             font-family:monospace;">
                  {code}
                </span>
              </div>

              <p style="margin:0;font-size:12px;color:#94a3b8;">
                If you didn't try to sign in, ignore this email.
                Your account remains secure.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
""",
    })
