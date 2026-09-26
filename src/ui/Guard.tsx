// A part of the modeler that fails while it is drawn says what went wrong in
// its place. Without a boundary React unmounts the whole page on such an
// error, and whatever was not saved is gone with it.

import { Component, ReactNode } from 'react';

interface Props {
  /** What the part is called in the message. */
  name: string;
  /** A new value shows the part again, as when another node is selected. */
  resetKey?: unknown;
  /** Offered beside "Try again"; asked when the part fails, so it sees the current state. */
  actions?: () => ReactNode;
  children: ReactNode;
}

interface State {
  error?: Error;
}

export class Guard extends Component<Props, State> {
  override state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidUpdate(previous: Props): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: undefined });
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="guard" role="alert">
        <div>The {this.props.name} stopped: {error.message}</div>
        <div className="row">
          <button onClick={() => this.setState({ error: undefined })}>Try again</button>
          {this.props.actions?.()}
        </div>
      </div>
    );
  }
}
