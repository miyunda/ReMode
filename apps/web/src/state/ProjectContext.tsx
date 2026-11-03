import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';
import { initialState, reducer, type Action, type ProjectState } from './project';

const StateContext = createContext<ProjectState | null>(null);
const DispatchContext = createContext<Dispatch<Action> | null>(null);

export function ProjectProvider({
  children,
  initial = initialState,
}: {
  children: ReactNode;
  initial?: ProjectState;
}) {
  const [state, dispatch] = useReducer(reducer, initial);
  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </StateContext.Provider>
  );
}

export function useProject(): ProjectState {
  const s = useContext(StateContext);
  if (!s) throw new Error('useProject outside ProjectProvider');
  return s;
}

export function useDispatch(): Dispatch<Action> {
  const d = useContext(DispatchContext);
  if (!d) throw new Error('useDispatch outside ProjectProvider');
  return d;
}
