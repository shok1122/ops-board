import axios from 'axios'

export const loginApi = (password: string) =>
  axios
    .post<{ token: string; auth_required: boolean }>('/api/v1/auth/login', { password })
    .then(r => r.data)
