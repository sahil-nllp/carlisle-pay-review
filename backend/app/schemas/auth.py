"""Auth request/response schemas."""
from pydantic import BaseModel, ConfigDict, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class UserResponse(BaseModel):
    """Public view of a User — never includes the password hash."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    name: str
    role: str
    site: str | None = None
    is_active: bool


class LoginResponse(BaseModel):
    user: UserResponse
