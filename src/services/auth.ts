import API from "./api";

export const loginUser = async (email: string, password: string) => {
  const res = await API.post("/auth/login", { email, password });
  return res.data;
};

export const registerUser = async (email: string, password: string) => {
  const res = await API.post("/auth/register", { email, password });
  return res.data;
};
